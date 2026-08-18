/**
 * Route stubs for the browser→S3 leg of an upload.
 *
 * Presigned PUTs are the one part of the flow that leaves the machine, so
 * answering them locally is what lets the non-destructive tiers drive a whole
 * upload — queue, progress, confirm, batch rows — without writing an object or
 * touching a bucket. The stub also counts overlap, which is the only way to
 * observe the client's upload concurrency from the outside.
 */
import type { Page } from '@playwright/test';

/** What the stub observed. Read after the assertions on the UI settle. */
export interface S3PutObserver {
    /** PUTs answered so far. */
    total: number;
    /** PUTs open right now. */
    inFlight: number;
    /** Highest `inFlight` seen — the client's real upload concurrency. */
    peak: number;
}

export interface StubS3PutsOptions {
    /**
     * Keep each PUT open this long before answering, so overlapping uploads
     * are actually concurrent rather than serialised by how fast the stub
     * replies. Omit for an instant answer.
     */
    holdMs?: number;
    /** Answer 500 for the one file whose URL contains this string. */
    failFor?: string;
    /**
     * Never answer at all. Leaves the upload in flight for as long as the test
     * needs (to click Cancel, or go offline) and writes nothing to S3.
     */
    stall?: boolean;
}

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'PUT,OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'ETag',
};

export async function stubS3Puts(
    page: Page,
    options: StubS3PutsOptions = {}
): Promise<S3PutObserver> {
    const seen: S3PutObserver = { total: 0, inFlight: 0, peak: 0 };

    await page.route(/amazonaws\.com/, async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: CORS_HEADERS });
            return;
        }
        seen.total++;
        seen.inFlight++;
        seen.peak = Math.max(seen.peak, seen.inFlight);

        // Never settled, and never decremented: the connection genuinely stays
        // open until teardown, which is the whole point of this mode.
        if (options.stall) return;

        try {
            if (options.holdMs) {
                await new Promise((resolve) =>
                    setTimeout(resolve, options.holdMs)
                );
            }
            const isDoomed =
                options.failFor !== undefined &&
                route.request().url().includes(options.failFor);
            await route.fulfill({
                status: isDoomed ? 500 : 200,
                headers: { ...CORS_HEADERS, ETag: '"e2e-stub"' },
            });
        } catch {
            // The browser hung up first — an upload aborted by a pause or a
            // cancel. There's nothing left to answer, but the connection is
            // just as closed as a fulfilled one, so it still has to be counted
            // out below or `peak` drifts up across the rest of the test.
        } finally {
            // Decremented once the response is delivered rather than before, so
            // `peak` covers the whole window the connection was open.
            seen.inFlight--;
        }
    });

    return seen;
}

/**
 * A real decodable image (1x1 transparent PNG), for tests that need the
 * preview/thumbnail pipeline to run rather than fall through to an icon tile.
 */
export function makePngFile(name: string): {
    name: string;
    mimeType: string;
    buffer: Buffer;
} {
    return {
        name,
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        ),
    };
}

/** Distinct text files, for driving a multi-file upload. */
export function makeTextFiles(
    count: number,
    prefix: string
): { name: string; mimeType: string; buffer: Buffer }[] {
    return Array.from({ length: count }, (_, i) => ({
        name: `${prefix}-${i}.txt`,
        mimeType: 'text/plain',
        // Lengths differ so a mixed-up name→row mapping can't pass by symmetry.
        buffer: Buffer.from(`${prefix} file ${i}${'!'.repeat(i)}\n`),
    }));
}

/**
 * Files big enough to take the multipart engine, written to disk and handed to
 * `setInputFiles` by path.
 *
 * By path, not by buffer, on purpose: a buffer is base64'd across the CDP
 * connection, so several hundred MB of fixtures would be copied twice before
 * the browser ever sees them. Returns a cleanup to call from `afterAll`.
 */
export async function writeLargeFiles(options: {
    count: number;
    prefix: string;
    bytes: number;
}): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'nexus-e2e-large-'));
    const paths: string[] = [];
    for (let i = 0; i < options.count; i++) {
        const path = join(dir, `${options.prefix}-${i}.bin`);
        // Zero-filled: the stub never inspects the bytes, and allocating is
        // faster than generating content no assertion reads.
        await writeFile(path, Buffer.alloc(options.bytes));
        paths.push(path);
    }
    return { paths, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

import { Readable } from 'node:stream';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRetrievalRequestFileFixture } from '@nexus/db/testing';

const hoisted = vi.hoisted(() => ({ send: vi.fn() }));

// The helper is imported inside the factory, not at the top of the file:
// `vi.mock` is hoisted above every import, so a module-scope binding it closed
// over would not be initialised yet.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const { mockS3Module } = await import('./testing/mockS3');
    return mockS3Module(importOriginal, hoisted.send);
});

import { createZipStream } from './zipStream';
import type { RetrievalRequestFile } from '@nexus/db/repo/retrievalRequests';

/** Zip signatures the assertions below key off. */
const LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP64_EOCD_LOCATOR = Buffer.from([0x50, 0x4b, 0x06, 0x07]);

function file(
    name: string,
    size: number,
    s3Key = `key/${name}`
): RetrievalRequestFile {
    return createRetrievalRequestFileFixture({
        fileId: `id-${name}-${s3Key}`,
        s3Key,
        name,
        size,
    });
}

/** Deterministic body for a key, so a round trip can be asserted byte-wise. */
function bodyFor(key: string, size: number): Buffer {
    return Buffer.alloc(size, key.charCodeAt(key.length - 1));
}

async function collect(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

/** Compression method of the nth local file header. 0 is STORE, 8 is deflate. */
function compressionMethods(zip: Buffer): number[] {
    const methods: number[] = [];
    let at = zip.indexOf(LOCAL_FILE_HEADER);
    while (at !== -1) {
        methods.push(zip.readUInt16LE(at + 8));
        at = zip.indexOf(LOCAL_FILE_HEADER, at + 4);
    }
    return methods;
}

describe('createZipStream', () => {
    /** Keys whose GetObject has actually been issued, in order. */
    let fetched: string[];
    /** Most response bodies open at once — the constant-memory invariant. */
    let peakConcurrentBodies: number;

    beforeEach(() => {
        vi.clearAllMocks();
        fetched = [];
        peakConcurrentBodies = 0;
        let live = 0;
        hoisted.send.mockImplementation(
            (command: { input: { Key: string } }) => {
                const key = command.input.Key;
                fetched.push(key);
                live++;
                peakConcurrentBodies = Math.max(peakConcurrentBodies, live);

                const body = Readable.from([bodyFor(key, sizes.get(key) ?? 0)]);
                body.once('end', () => live--);
                return Promise.resolve({ Body: body });
            }
        );
    });

    const sizes = new Map<string, number>();
    function given(files: RetrievalRequestFile[]): RetrievalRequestFile[] {
        sizes.clear();
        for (const f of files) sizes.set(f.s3Key, f.size);
        return files;
    }

    it('stores file bytes verbatim — STORE, never deflate', async () => {
        const files = given([file('a.cr2', 2048), file('b.cr2', 4096)]);

        const zip = await collect(createZipStream('bucket', files));

        expect(compressionMethods(zip)).toEqual([0, 0]);
        expect(zip.includes(bodyFor('key/a.cr2', 2048))).toBe(true);
        expect(zip.includes(bodyFor('key/b.cr2', 4096))).toBe(true);
    });

    it('produces an archive with no zip64 records', async () => {
        const files = given([file('a.cr2', 1024)]);

        const zip = await collect(createZipStream('bucket', files));

        expect(zip.includes(END_OF_CENTRAL_DIRECTORY)).toBe(true);
        expect(zip.includes(ZIP64_EOCD_LOCATOR)).toBe(false);
    });

    // The property that makes a 1,500-file chunk survive a Lambda: yazl is
    // handed every entry up front, but each one is inert until pumped, and
    // backpressure stops the pump once the output buffer fills. How many that
    // is depends on the buffer, not on the file count — which is the whole
    // point, so the files here are larger than a stream's default high-water
    // mark to make the difference visible.
    it('does not open the whole file set up front', async () => {
        const files = given(
            Array.from({ length: 20 }, (_, i) => file(`f${i}.cr2`, 65536))
        );

        const stream = createZipStream('bucket', files);
        await new Promise(setImmediate);
        const openedBeforeConsuming = fetched.length;

        // Drain rather than destroy, so a half-pumped entry can't spill its
        // fetch into the next test.
        await collect(stream);

        expect(openedBeforeConsuming).toBeLessThan(files.length);
        expect(fetched).toHaveLength(20);
    });

    it('holds only one object open at a time, in order', async () => {
        const files = given([
            file('a.cr2', 1024),
            file('b.cr2', 1024),
            file('c.cr2', 1024),
        ]);

        await collect(createZipStream('bucket', files));

        expect(fetched).toEqual(['key/a.cr2', 'key/b.cr2', 'key/c.cr2']);
        expect(peakConcurrentBodies).toBe(1);
    });

    // Burst siblings from two shoots are routinely both `_MG_4501.CR2`, and a
    // zip with duplicate entry names silently loses one on extraction.
    it('disambiguates files that share a name', async () => {
        const files = given([
            file('_MG_4501.CR2', 16, 'shootA/_MG_4501.CR2'),
            file('_MG_4501.CR2', 32, 'shootB/_MG_4501.CR2'),
            file('_MG_4501.CR2', 48, 'shootC/_MG_4501.CR2'),
        ]);

        const zip = await collect(createZipStream('bucket', files));
        const text = zip.toString('latin1');

        expect(text).toContain('_MG_4501.CR2');
        expect(text).toContain('_MG_4501 (2).CR2');
        expect(text).toContain('_MG_4501 (3).CR2');
    });

    it('flattens path-shaped names so nothing extracts outside the folder', async () => {
        const files = given([file('../../etc/passwd', 16, 'key/escape')]);

        const zip = await collect(createZipStream('bucket', files));
        const text = zip.toString('latin1');

        expect(text).not.toContain('../');
        expect(text).toContain('etc_passwd');
    });

    // The size on the row is what the user's quota was billed on and what the
    // partition packed against, so S3 disagreeing with it is a real defect.
    it('fails the build when S3 returns a different number of bytes', async () => {
        const files = given([file('a.cr2', 1024)]);
        sizes.set('key/a.cr2', 999);

        await expect(
            collect(createZipStream('bucket', files))
        ).rejects.toThrow();
    });
});

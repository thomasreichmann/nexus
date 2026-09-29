/**
 * The thumbnail job against the real ffmpeg, ffprobe and perl/exiftool: the
 * command lines that generateThumbnail.integration.test.ts fakes at
 * `execFile` and so can't judge (#523). A broken flag marks every upload
 * `failed`, or leaves a ready row with no dimensions or duration, and no
 * alarm notices.
 *
 * The binaries are the Lambda layers (tooling/lambda-layers/*.sh) unzipped to
 * /opt the way Lambda mounts them: /opt/bin on PATH, /opt/lib on
 * LD_LIBRARY_PATH, and no *_PATH overrides, so the handler's own defaults are
 * what runs. The `Thumbnail toolchain` workflow sets that up. To run it
 * locally, see "Integration Tests" in docs/conventions/testing.md. Without
 * the binaries the suite skips with a notice, unless
 * THUMBNAIL_TOOLCHAIN_REQUIRED=1 is set, which turns the skip into a failure.
 *
 * Only what leaves the process is faked. S3 is faked at the client's `send`
 * and serves each fixture's bytes, honouring `Range`. The presigned URL points
 * at a local HTTP server with range support, so ffprobe and ffmpeg read the
 * clip the way they read S3.
 *
 * Fixtures, in __fixtures__/:
 * - landscape.jpg (1200x800) and portrait.png (600x900) are longer than 512px,
 *   so the scale filter has work to do.
 * - clip.mp4 is 4s long: black for 2s, then white.
 * - d80-head.nef is the first 1,412,146 bytes of a CC0 Nikon D80 NEF from
 *   raw.pixls.us (DSC_1114.NEF, sha256 745cb067…b1d066), which ends where its
 *   1.18 MiB JpgFromRaw preview does. That preview is larger than Node's
 *   default 1 MiB maxBuffer, so it only comes out with the handler's own.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createFileRepo, thumbnailKey } from '@nexus/db/repo/files';
import { insertFile } from '@nexus/db/test-db';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from '@nexus/db/test-db/integration';
import { afterAll, beforeAll, vi } from 'vitest';
import { generateThumbnail } from './generateThumbnail';
import type { GetObjectCommand } from '@aws-sdk/client-s3';
import type { DB } from '@nexus/db';
import type { File } from '@nexus/db/repo/files';
import type { AddressInfo } from 'node:net';

const fakes = vi.hoisted(() => {
    /** The originals bucket: S3 key → the object's bytes. */
    const objects = new Map<string, Buffer>();
    /** Thumbnail uploads: S3 key → body. */
    const uploads = new Map<string, Buffer>();
    /** Where presigned URLs point: the local server in front of `objects`. */
    const presign = { origin: '' };

    /**
     * The bytes a `Range: bytes=a-b` (or `bytes=a-`) header asks for, clamped
     * to the object like S3 and HTTP servers do. Null for no header.
     */
    function byteRange(
        header: string | undefined,
        size: number
    ): { start: number; end: number } | null {
        const match = header?.match(/^bytes=(\d+)-(\d*)$/);
        if (!match) return null;
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        return { start, end };
    }

    async function send(command: unknown): Promise<unknown> {
        const { GetObjectCommand: Get, PutObjectCommand: Put } =
            await import('@aws-sdk/client-s3');
        if (command instanceof Get) {
            const { Key, Range } = command.input;
            const bytes = objects.get(Key!);
            if (!bytes) throw new Error(`no object at ${Key}`);
            const range = byteRange(Range, bytes.length);
            const body = range
                ? bytes.subarray(range.start, range.end + 1)
                : bytes;
            const { Readable } = await import('node:stream');
            return { Body: Readable.from([body]) };
        }
        if (command instanceof Put) {
            uploads.set(command.input.Key!, command.input.Body as Buffer);
            return {};
        }
        throw new Error(`unexpected S3 command ${String(command)}`);
    }

    return { objects, uploads, presign, byteRange, send: vi.fn(send) };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const { mockS3Module } = await import('../testing');
    return mockS3Module(importOriginal, fakes.send);
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: async (_client: unknown, command: GetObjectCommand) =>
        `${fakes.presign.origin}/${command.input.Key}`,
}));

const { objects, uploads, presign, byteRange } = fakes;
const FIXTURES = path.join(import.meta.dirname, '__fixtures__');

/**
 * The binaries as the handler resolves them. Resolved here rather than
 * imported, so a mutant of the handler's default paths fails the tests
 * instead of turning them into a skip.
 */
const TOOLS: Record<string, [string, ...string[]]> = {
    ffmpeg: [process.env.FFMPEG_PATH ?? 'ffmpeg', '-version'],
    ffprobe: [process.env.FFPROBE_PATH ?? 'ffprobe', '-version'],
    'perl/exiftool': [
        process.env.PERL_PATH ?? '/opt/perl/bin/perl',
        process.env.EXIFTOOL_PATH ?? '/opt/exiftool/exiftool',
        '-ver',
    ],
};

function missingTools(): string[] {
    return Object.entries(TOOLS).flatMap(([name, [command, ...args]]) => {
        const run = spawnSync(command, args, { encoding: 'utf8' });
        if (run.status === 0) return [];
        const reason = run.error?.message ?? run.stderr.trim().split('\n')[0];
        return [`${name} (${reason})`];
    });
}

const missing = missingTools();
if (missing.length > 0) {
    const reason = `the thumbnail toolchain is missing ${missing.join(', ')}`;
    if (process.env.THUMBNAIL_TOOLCHAIN_REQUIRED === '1') {
        throw new Error(`THUMBNAIL_TOOLCHAIN_REQUIRED=1, but ${reason}`);
    }
    console.warn(
        `Skipping generateThumbnail.toolchain: ${reason}. To run it, see "Integration Tests" in docs/conventions/testing.md.`
    );
}

const server = createServer((request, response) => {
    const bytes = objects.get(decodeURIComponent(request.url!.slice(1)));
    if (!bytes) {
        response.writeHead(404).end();
        return;
    }
    const range = byteRange(request.headers.range, bytes.length);
    if (!range) {
        response.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': bytes.length,
        });
        response.end(bytes);
        return;
    }
    response.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Length': range.end - range.start + 1,
        'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
    });
    response.end(bytes.subarray(range.start, range.end + 1));
});

beforeAll(async () => {
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    presign.origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
    objects.clear();
    uploads.clear();
    vi.stubEnv('S3_BUCKET', 'nexus-originals-test');
    vi.stubEnv('S3_DERIVED_BUCKET', 'nexus-derived-test');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

/** A file row whose object in the originals bucket is `fixture`'s bytes. */
async function insertFixture(
    db: DB,
    userId: string,
    name: string,
    fixture: string
): Promise<File> {
    const bytes = readFileSync(path.join(FIXTURES, fixture));
    const file = await insertFile(db, {
        userId,
        name,
        size: bytes.length,
        mimeType: 'application/octet-stream',
    });
    objects.set(file.s3Key, bytes);
    return file;
}

async function runJob(db: DB, file: File): Promise<File> {
    await generateThumbnail({
        jobId: 'job-under-test',
        payload: { fileId: file.id },
        db,
    });
    const row = await createFileRepo(db).findById(file.id);
    if (!row) throw new Error(`file ${file.id} is gone`);
    return row;
}

/** The file format the uploaded thumbnail's bytes say it is. */
function uploadedFormat(file: File): string {
    const body = uploads.get(thumbnailKey(file));
    if (!body) return 'nothing uploaded';
    const riff = body.subarray(0, 4).toString('latin1');
    const format = body.subarray(8, 12).toString('latin1');
    return riff === 'RIFF' ? format : 'not RIFF';
}

/** The uploaded thumbnail's mean luma, 0 (black) to 255, read by ffmpeg. */
function uploadedLuma(file: File): number {
    const body = uploads.get(thumbnailKey(file));
    if (!body) throw new Error('no thumbnail was uploaded');
    const [ffmpeg] = TOOLS.ffmpeg!;
    const run = spawnSync(
        ffmpeg,
        [
            '-hide_banner',
            '-nostats',
            '-i',
            'pipe:',
            '-vf',
            'signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG',
            '-c:v',
            'png',
            '-f',
            'null',
            '-',
        ],
        { input: body, encoding: 'utf8' }
    );
    const match = run.stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (!match) throw new Error(`ffmpeg measured no luma: ${run.stderr}`);
    return Number(match[1]);
}

describe.skipIf(missing.length > 0)(
    'generateThumbnail with the real ffmpeg, ffprobe and exiftool',
    () => {
        it.for([
            // 512 on the long edge, the other scaled to keep the ratio.
            ['a JPEG', 'photo.jpg', 'landscape.jpg', 512, 341],
            ['a PNG', 'scan.png', 'portrait.png', 341, 512],
            [
                "a RAW's embedded preview",
                'DSC_1114.NEF',
                'd80-head.nef',
                512,
                343,
            ],
        ] as const)(
            'thumbnails %s to a WebP that fits 512px, and records its size',
            async ([, name, fixture, width, height], { db, user }) => {
                const file = await insertFixture(db, user.id, name, fixture);

                const row = await runJob(db, file);

                expect(row).toMatchObject({
                    thumbnailStatus: 'ready',
                    thumbnailWidth: width,
                    thumbnailHeight: height,
                    durationSeconds: null,
                });
                expect(uploadedFormat(file)).toBe('WEBP');
            }
        );

        it('thumbnails an MP4 read over HTTP ranges, and records its size and duration', async ({
            db,
            user,
        }) => {
            const file = await insertFixture(
                db,
                user.id,
                'clip.mp4',
                'clip.mp4'
            );

            const row = await runJob(db, file);

            expect(row).toMatchObject({
                thumbnailStatus: 'ready',
                thumbnailWidth: 512,
                thumbnailHeight: 288,
                durationSeconds: 4,
            });
            expect(uploadedFormat(file)).toBe('WEBP');
        });

        it('takes the poster from 3s into the clip, past its black lead-in', async ({
            db,
            user,
        }) => {
            const file = await insertFixture(
                db,
                user.id,
                'clip.mp4',
                'clip.mp4'
            );

            await runJob(db, file);

            expect(uploadedLuma(file)).toBeGreaterThan(200);
        });
    }
);

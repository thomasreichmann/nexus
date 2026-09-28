/**
 * The thumbnail job against a real database: every outcome is a
 * `thumbnailStatus` the handler writes, so each test reads the row back.
 * Only what leaves the process is faked:
 *
 * - S3 at the client's `send`: GetObject serves an object whose bytes say
 *   whether the request was ranged, PutObject records the upload.
 * - ffmpeg, ffprobe and exiftool at `execFile`: a small model of each tool,
 *   driven by `toolchain`. The webp "ffmpeg" writes names its input and seek
 *   position, so a test can see which frame of what became the thumbnail.
 *
 * The tool fakes judge behaviour, not command lines: whether the scale filter
 * or the exiftool flags are right only shows against the real binaries, so
 * `pnpm mutate` leaves those argv literals as survivors on purpose.
 */
import { existsSync } from 'node:fs';
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
import { vi } from 'vitest';
import { invalidObjectState, notFound } from '../testing';
import { generateThumbnail } from './generateThumbnail';
import type { GetObjectCommand } from '@aws-sdk/client-s3';
import type { DB } from '@nexus/db';
import type { File } from '@nexus/db/repo/files';

interface Toolchain {
    /** Where exiftool finds the RAW's embedded preview; 'unreadable' exits non-zero. */
    rawPreview: 'in-head' | 'past-head' | 'none' | 'unreadable';
    /** The exiftool tag that holds the preview. */
    rawPreviewTag: '-JpgFromRaw' | '-PreviewImage';
    /** Which frames ffmpeg can decode from its input. */
    frames: 'all' | 'first-only' | 'none';
    /**
     * What ffprobe prints for the source video's duration: 'N/A' for a
     * stream without one, null when it can't read the file at all.
     */
    videoDuration: number | 'N/A' | null;
    /** What ffprobe reports for the webp ffmpeg wrote; null when it can't read it. */
    thumbnailSize: { width: number; height: number } | null;
    /** A binary the Lambda layer failed to provide. */
    missingBinary: 'ffmpeg' | 'ffprobe' | null;
}

interface Upload {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
}

const fakes = vi.hoisted(() => {
    const HEAD_BYTES = 'the first bytes of the object';
    const FULL_BYTES = 'the whole object';

    const toolchain = {} as Toolchain;
    /** Every file ffmpeg wrote, which sits in the handler's work directory. */
    const ffmpegOutputs: string[] = [];
    const s3 = {
        /** GetObject throws this instead of serving the object. */
        getError: null as Error | null,
        /** PutObject throws this instead of storing the upload. */
        putError: null as Error | null,
        gets: [] as { Key: string; Range: string | undefined }[],
        puts: [] as Upload[],
    };

    function exitError(tool: string, code: number | string): Error {
        return Object.assign(new Error(`${tool} failed`), {
            code,
            stderr: '',
        });
    }

    async function exiftool(tag: string, source: string): Promise<Buffer> {
        if (toolchain.rawPreview === 'unreadable') throw exitError('perl', 1);
        const { readFile: read } = await import('node:fs/promises');
        const isFullObject = (await read(source, 'utf8')) === FULL_BYTES;
        const isFound =
            tag === toolchain.rawPreviewTag &&
            (toolchain.rawPreview === 'in-head' ||
                (toolchain.rawPreview === 'past-head' && isFullObject));
        return isFound ? Buffer.from('embedded jpeg') : Buffer.alloc(0);
    }

    async function ffmpeg(args: string[]): Promise<string> {
        const seekAt = args.indexOf('-ss');
        const seek = seekAt === -1 ? 0 : Number(args[seekAt + 1]);
        const inputAt = args.indexOf('-i');
        const input = args[inputAt + 1]!;
        const output = args.at(-1)!;
        if (
            // Like ffmpeg, refuse a command line with no input or output
            // file, rather than writing wherever the last argument points.
            inputAt === -1 ||
            !output.startsWith('/') ||
            toolchain.frames === 'none' ||
            (toolchain.frames === 'first-only' && seek > 0)
        ) {
            throw exitError('ffmpeg', 1);
        }
        const { writeFile: write } = await import('node:fs/promises');
        const from = input.startsWith('https://')
            ? input
            : input.slice(input.lastIndexOf('/') + 1);
        await write(output, JSON.stringify({ from, at: seek }));
        ffmpegOutputs.push(output);
        return '';
    }

    function ffprobe(args: string[]): string {
        if (args.includes('format=duration')) {
            if (toolchain.videoDuration === null) throw exitError('ffprobe', 1);
            return `${toolchain.videoDuration}\n`;
        }
        if (toolchain.thumbnailSize === null) throw exitError('ffprobe', 1);
        const { width, height } = toolchain.thumbnailSize;
        return `${width}x${height}\n`;
    }

    async function run(command: string, args: string[]): Promise<unknown> {
        const tool = command.slice(command.lastIndexOf('/') + 1);
        if (tool === toolchain.missingBinary) {
            throw exitError(`spawn ${tool}`, 'ENOENT');
        }
        if (tool.includes('ffprobe')) return ffprobe(args);
        if (tool.includes('ffmpeg')) return ffmpeg(args);
        // perl running exiftool: [exiftool, -m, -b, <tag>, <source>]
        return exiftool(args[3]!, args[4]!);
    }

    /** `execFile`'s callback form, which `promisify` wraps. */
    function execFile(command: string, args: string[], ...rest: unknown[]) {
        const callback = rest.at(-1) as (
            error: Error | null,
            result?: { stdout: unknown; stderr: string }
        ) => void;
        run(command, args).then(
            (stdout) => callback(null, { stdout, stderr: '' }),
            (error: Error) => callback(error)
        );
    }

    async function send(command: unknown): Promise<unknown> {
        const { GetObjectCommand: Get, PutObjectCommand: Put } =
            await import('@aws-sdk/client-s3');
        if (command instanceof Get) {
            const { Key, Range } = command.input;
            s3.gets.push({ Key: Key!, Range });
            if (s3.getError) throw s3.getError;
            const bytes = Range ? HEAD_BYTES : FULL_BYTES;
            const { Readable: Stream } = await import('node:stream');
            return { Body: Stream.from([Buffer.from(bytes)]) };
        }
        if (command instanceof Put) {
            if (s3.putError) throw s3.putError;
            s3.puts.push(command.input as Upload);
            return {};
        }
        throw new Error(`unexpected S3 command ${String(command)}`);
    }

    return { toolchain, ffmpegOutputs, s3, execFile, send: vi.fn(send) };
});

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const { mockS3Module } = await import('../testing');
    return mockS3Module(importOriginal, fakes.send);
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: async (_client: unknown, command: GetObjectCommand) =>
        `https://presigned.test/${command.input.Key}`,
}));

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:child_process')>()),
    execFile: fakes.execFile,
}));

const { toolchain, ffmpegOutputs, s3 } = fakes;
const DERIVED_BUCKET = 'nexus-derived-test';
const MIB = 1024 * 1024;
/** How much of a RAW the handler reads first, looking for its preview. */
const RAW_HEAD = 8 * MIB;

beforeEach(() => {
    Object.assign(toolchain, {
        rawPreview: 'in-head',
        rawPreviewTag: '-JpgFromRaw',
        frames: 'all',
        videoDuration: 12.6,
        thumbnailSize: { width: 512, height: 384 },
        missingBinary: null,
    } satisfies Toolchain);
    Object.assign(s3, { getError: null, putError: null, gets: [], puts: [] });
    ffmpegOutputs.length = 0;
    vi.stubEnv('S3_BUCKET', 'nexus-originals-test');
    vi.stubEnv('S3_DERIVED_BUCKET', DERIVED_BUCKET);
    // The handler warns on every non-ready outcome; that's its log, not ours.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

function insertMedia(
    db: DB,
    userId: string,
    name: string,
    overrides: Partial<File> = {}
): Promise<File> {
    return insertFile(db, {
        userId,
        name,
        mimeType: 'application/octet-stream',
        ...overrides,
    });
}

async function runJob(db: DB, file: Pick<File, 'id'>): Promise<File> {
    await generateThumbnail({
        jobId: 'job-under-test',
        payload: { fileId: file.id },
        db,
    });
    return readRow(db, file);
}

async function readRow(db: DB, file: Pick<File, 'id'>): Promise<File> {
    const row = await createFileRepo(db).findById(file.id);
    if (!row) throw new Error(`file ${file.id} is gone`);
    return row;
}

/** What landed in the derived bucket under the file's thumbnail key. */
function uploadedThumbnail(
    file: File
): { contentType: string; frame: { from: string; at: number } } | undefined {
    const upload = s3.puts.find(
        (put) => put.Bucket === DERIVED_BUCKET && put.Key === thumbnailKey(file)
    );
    return (
        upload && {
            contentType: upload.ContentType,
            frame: JSON.parse(upload.Body.toString('utf8')),
        }
    );
}

const presignedUrl = (file: File): string =>
    `https://presigned.test/${file.s3Key}`;

describe('generateThumbnail', () => {
    describe('rows with nothing to generate', () => {
        it('completes when the row is already gone', async ({ db }) => {
            await expect(
                generateThumbnail({
                    jobId: 'job-under-test',
                    payload: { fileId: crypto.randomUUID() },
                    db,
                })
            ).resolves.toBeUndefined();
        });

        it('marks a file deleted before the job ran as skipped', async ({
            db,
            user,
        }) => {
            const file = await insertMedia(db, user.id, 'photo.jpg', {
                status: 'deleted',
                deletedAt: new Date(),
            });

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('skipped');
            expect(s3.gets).toEqual([]);
        });

        it('marks a file that is not an image or video as skipped', async ({
            db,
            user,
        }) => {
            const file = await insertMedia(db, user.id, 'notes.pdf', {
                mimeType: 'application/pdf',
            });

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('skipped');
        });

        it('leaves a ready thumbnail alone on a duplicate delivery', async ({
            db,
            user,
        }) => {
            const file = await insertMedia(db, user.id, 'photo.jpg', {
                thumbnailStatus: 'ready',
                thumbnailWidth: 300,
                thumbnailHeight: 200,
            });

            const row = await runJob(db, file);

            expect(row).toMatchObject({
                thumbnailStatus: 'ready',
                thumbnailWidth: 300,
                thumbnailHeight: 200,
            });
            expect(uploadedThumbnail(file)).toBeUndefined();
        });
    });

    describe('archived originals', () => {
        it.for(['photo.jpg', 'clip.mp4'])(
            'marks %s failed_cold when S3 says the object is archived',
            async (name, { db, user }) => {
                s3.getError = invalidObjectState();
                const file = await insertMedia(db, user.id, name);

                const row = await runJob(db, file);

                expect(row.thumbnailStatus).toBe('failed_cold');
            }
        );

        it.for(['photo.jpg', 'clip.mp4'])(
            'throws for a retry, leaving %s pending, on any other S3 read error',
            async (name, { db, user }) => {
                s3.getError = notFound();
                const file = await insertMedia(db, user.id, name);

                await expect(runJob(db, file)).rejects.toThrow('NotFound');

                expect((await readRow(db, file)).thumbnailStatus).toBe(
                    'pending'
                );
            }
        );
    });

    describe('images', () => {
        it('uploads a webp and marks the image ready with its dimensions', async ({
            db,
            user,
        }) => {
            toolchain.thumbnailSize = { width: 512, height: 341 };
            const file = await insertMedia(db, user.id, 'photo.jpg');

            const row = await runJob(db, file);

            expect(row).toMatchObject({
                thumbnailStatus: 'ready',
                thumbnailWidth: 512,
                thumbnailHeight: 341,
                durationSeconds: null,
            });
            expect(uploadedThumbnail(file)).toEqual({
                contentType: 'image/webp',
                frame: { from: 'source', at: 0 },
            });
        });

        it('reads an ordinary image whole: only a RAW is cut to its first 8 MiB', async ({
            db,
            user,
        }) => {
            // A truncated PNG or JPEG decodes to a half-grey thumbnail.
            const file = await insertMedia(db, user.id, 'scan.png', {
                size: 20 * MIB,
            });

            await runJob(db, file);

            expect(s3.gets).toEqual([{ Key: file.s3Key, Range: undefined }]);
        });

        it('marks an image ffmpeg cannot decode failed', async ({
            db,
            user,
        }) => {
            toolchain.frames = 'none';
            const file = await insertMedia(db, user.id, 'photo.jpg');

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('failed');
            expect(uploadedThumbnail(file)).toBeUndefined();
        });

        it('still marks the thumbnail ready when ffprobe cannot size the webp', async ({
            db,
            user,
        }) => {
            toolchain.thumbnailSize = null;
            const file = await insertMedia(db, user.id, 'photo.jpg');

            const row = await runJob(db, file);

            expect(row).toMatchObject({
                thumbnailStatus: 'ready',
                thumbnailWidth: null,
                thumbnailHeight: null,
            });
        });
    });

    describe('RAW photos', () => {
        it('thumbnails the embedded preview from a ranged read of the first 8 MiB', async ({
            db,
            user,
        }) => {
            toolchain.rawPreview = 'in-head';
            const file = await insertMedia(db, user.id, 'shot.nef', {
                size: 40 * MIB,
            });

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('ready');
            expect(uploadedThumbnail(file)?.frame).toEqual({
                from: 'preview.jpg',
                at: 0,
            });
            expect(s3.gets).toEqual([
                { Key: file.s3Key, Range: `bytes=0-${RAW_HEAD - 1}` },
            ]);
        });

        it('falls back to the PreviewImage tag when there is no JpgFromRaw', async ({
            db,
            user,
        }) => {
            toolchain.rawPreviewTag = '-PreviewImage';
            const file = await insertMedia(db, user.id, 'shot.cr2');

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('ready');
            expect(uploadedThumbnail(file)?.frame.from).toBe('preview.jpg');
        });

        it('fetches the whole object when the preview sits past the first 8 MiB', async ({
            db,
            user,
        }) => {
            toolchain.rawPreview = 'past-head';
            const file = await insertMedia(db, user.id, 'shot.arw', {
                size: RAW_HEAD + 1,
            });

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('ready');
            expect(s3.gets.map((get) => get.Range)).toEqual([
                `bytes=0-${RAW_HEAD - 1}`,
                undefined,
            ]);
        });

        it('marks a RAW failed without a second read when the first 8 MiB was all of it', async ({
            db,
            user,
        }) => {
            toolchain.rawPreview = 'none';
            const file = await insertMedia(db, user.id, 'shot.nef', {
                size: RAW_HEAD,
            });

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('failed');
            expect(s3.gets).toHaveLength(1);
        });

        it('marks a RAW exiftool cannot read failed rather than retrying it', async ({
            db,
            user,
        }) => {
            toolchain.rawPreview = 'unreadable';
            const file = await insertMedia(db, user.id, 'shot.nef');

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('failed');
        });
    });

    describe('videos', () => {
        it('takes the poster 3s in and records the rounded duration', async ({
            db,
            user,
        }) => {
            toolchain.videoDuration = 12.6;
            const file = await insertMedia(db, user.id, 'clip.mp4');

            const row = await runJob(db, file);

            expect(row).toMatchObject({
                thumbnailStatus: 'ready',
                durationSeconds: 13,
            });
            expect(uploadedThumbnail(file)?.frame).toEqual({
                from: presignedUrl(file),
                at: 3,
            });
        });

        it('seeks half a second before the end of a clip shorter than 3s', async ({
            db,
            user,
        }) => {
            toolchain.videoDuration = 1.2;
            const file = await insertMedia(db, user.id, 'clip.mov');

            const row = await runJob(db, file);

            expect(row.durationSeconds).toBe(1);
            expect(uploadedThumbnail(file)?.frame.at).toBe(0.7);
        });

        it('checks the clip is readable with a one-byte read, never downloading it', async ({
            db,
            user,
        }) => {
            const file = await insertMedia(db, user.id, 'clip.mp4', {
                size: 4 * 1024 * MIB,
            });

            await runJob(db, file);

            expect(s3.gets).toEqual([{ Key: file.s3Key, Range: 'bytes=0-0' }]);
        });

        it.for([
            ['cannot read the clip', null],
            ['reports no duration', 'N/A'],
        ] as const)(
            'uses the first frame, with no duration, when ffprobe %s',
            async ([, duration], { db, user }) => {
                toolchain.videoDuration = duration;
                const file = await insertMedia(db, user.id, 'clip.mp4');

                const row = await runJob(db, file);

                expect(row).toMatchObject({
                    thumbnailStatus: 'ready',
                    durationSeconds: null,
                });
                expect(uploadedThumbnail(file)?.frame.at).toBe(0);
            }
        );

        it('falls back to the first frame when the seek yields none', async ({
            db,
            user,
        }) => {
            toolchain.frames = 'first-only';
            const file = await insertMedia(db, user.id, 'clip.mp4');

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('ready');
            expect(uploadedThumbnail(file)?.frame.at).toBe(0);
        });

        it('marks a video ffmpeg cannot decode failed', async ({
            db,
            user,
        }) => {
            toolchain.frames = 'none';
            const file = await insertMedia(db, user.id, 'clip.mp4');

            const row = await runJob(db, file);

            expect(row.thumbnailStatus).toBe('failed');
        });
    });

    describe('systemic failures throw for the DLQ instead of marking the file', () => {
        it.for([
            ['ffmpeg', 'photo.jpg'],
            // Sizing the finished webp.
            ['ffprobe', 'photo.jpg'],
        ] as const)(
            'a missing %s binary, thumbnailing %s',
            async ([binary, name], { db, user }) => {
                toolchain.missingBinary = binary;
                const file = await insertMedia(db, user.id, name);

                await expect(runJob(db, file)).rejects.toMatchObject({
                    code: 'ENOENT',
                });

                expect((await readRow(db, file)).thumbnailStatus).toBe(
                    'pending'
                );
            }
        );

        it('a missing ffprobe binary, even on a clip ffmpeg cannot decode', async ({
            db,
            user,
        }) => {
            // The duration probe is the only ffprobe call before a clip that
            // yields no frame is marked 'failed' for good.
            toolchain.missingBinary = 'ffprobe';
            toolchain.frames = 'none';
            const file = await insertMedia(db, user.id, 'clip.mp4');

            await expect(runJob(db, file)).rejects.toMatchObject({
                code: 'ENOENT',
            });

            expect((await readRow(db, file)).thumbnailStatus).toBe('pending');
        });

        it('a failed thumbnail upload, which must leave the row short of ready', async ({
            db,
            user,
        }) => {
            s3.putError = Object.assign(new Error('SlowDown'), {
                name: 'SlowDown',
            });
            const file = await insertMedia(db, user.id, 'photo.jpg');

            await expect(runJob(db, file)).rejects.toThrow('SlowDown');

            expect((await readRow(db, file)).thumbnailStatus).toBe('pending');
        });

        it('a job that throws still clears its work directory out of /tmp', async ({
            db,
            user,
        }) => {
            // A warm Lambda reuses /tmp; leaked sources and webps pile up
            // until later jobs fail on a full disk.
            s3.putError = new Error('SlowDown');
            const file = await insertMedia(db, user.id, 'photo.jpg');

            await expect(runJob(db, file)).rejects.toThrow('SlowDown');

            const workDir = path.dirname(ffmpegOutputs[0]!);
            expect(existsSync(workDir)).toBe(false);
        });
    });
});

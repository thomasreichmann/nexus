import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createFileRepo, thumbnailKey, type File } from '@nexus/db/repo/files';
import type { HandlerContext } from '../registry';

const execFileAsync = promisify(execFile);

// Binaries come from the Lambda layers (infra/terraform/layers.tf): /opt/bin
// is on the Lambda PATH, perl/exiftool mount at fixed paths. The env
// overrides exist for local runs/tests against system binaries.
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const PERL = process.env.PERL_PATH ?? '/opt/perl/bin/perl';
const EXIFTOOL = process.env.EXIFTOOL_PATH ?? '/opt/exiftool/exiftool';

// The spike (#350) showed an 8MB head holds the embedded preview for every
// tested RAW format (NEF/CR2/CR3/ARW/RAF); the full-object fetch is the
// fallback, not the norm.
const RAW_HEAD_BYTES = 8 * 1024 * 1024;
// Embedded previews run multi-MB at full camera resolution.
const EXIFTOOL_MAX_BUFFER = 64 * 1024 * 1024;
const THUMBNAIL_MAX_EDGE = 512;
const PRESIGN_EXPIRY_SECONDS = 600;
// Cap the poster seek: deep enough to skip black lead-ins, shallow enough
// that ffmpeg's range seeks stay cheap.
const VIDEO_POSTER_SEEK_SECONDS = 3;

// Scale to fit within 512x512 without upscaling smaller sources.
const SCALE_FILTER = `scale=w='min(${THUMBNAIL_MAX_EDGE},iw)':h='min(${THUMBNAIL_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`;

const RAW_EXTENSIONS = new Set([
    'arw',
    'cr2',
    'cr3',
    'dng',
    'nef',
    'nrw',
    'orf',
    'pef',
    'raf',
    'rw2',
    'sr2',
    'srw',
]);
const IMAGE_EXTENSIONS = new Set([
    'avif',
    'bmp',
    'gif',
    'heic',
    'heif',
    'jpeg',
    'jpg',
    'png',
    'tif',
    'tiff',
    'webp',
]);
const VIDEO_EXTENSIONS = new Set([
    '3gp',
    'avi',
    'm2ts',
    'm4v',
    'mkv',
    'mov',
    'mp4',
    'mpeg',
    'mpg',
    'mts',
    'webm',
    'wmv',
]);

export type MediaKind = 'raw' | 'image' | 'video';

/** Exported for tests. Extension wins over the client-supplied mime type. */
export function classifyMedia(
    file: Pick<File, 'name' | 'mimeType'>
): MediaKind | null {
    const ext = path.extname(file.name).slice(1).toLowerCase();
    if (RAW_EXTENSIONS.has(ext)) return 'raw';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (file.mimeType?.startsWith('image/')) return 'image';
    if (file.mimeType?.startsWith('video/')) return 'video';
    return null;
}

// Lazily constructed so importing the handler never requires env/AWS setup
// (mirrors getDb in ../handler.ts). Region comes from the Lambda runtime.
let s3Client: S3Client | undefined;
function getS3(): S3Client {
    s3Client ??= new S3Client({});
    return s3Client;
}

function getBucket(name: 'S3_BUCKET' | 'S3_DERIVED_BUCKET'): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set. Configure it on the Lambda function (infra/terraform/lambda.tf).`
        );
    }
    return value;
}

/** S3's "this object is archived" error — the failed_cold trigger. */
function isInvalidObjectState(error: unknown): boolean {
    return error instanceof Error && error.name === 'InvalidObjectState';
}

async function downloadObject(
    s3Key: string,
    dest: string,
    range?: string
): Promise<void> {
    const response = await getS3().send(
        new GetObjectCommand({
            Bucket: getBucket('S3_BUCKET'),
            Key: s3Key,
            Range: range,
        })
    );
    await pipeline(response.Body as Readable, createWriteStream(dest));
}

/**
 * Extract the embedded JPEG preview from a RAW file. Tries the full-size
 * JpgFromRaw first, then PreviewImage; -m tolerates the truncated tail of a
 * ranged download. Returns null when neither tag yields bytes.
 */
async function extractRawPreview(
    srcPath: string,
    destPath: string
): Promise<string | null> {
    for (const tag of ['-JpgFromRaw', '-PreviewImage']) {
        try {
            const { stdout } = await execFileAsync(
                PERL,
                [EXIFTOOL, '-m', '-b', tag, srcPath],
                { encoding: 'buffer', maxBuffer: EXIFTOOL_MAX_BUFFER }
            );
            if (stdout.length > 0) {
                await writeFile(destPath, stdout);
                return destPath;
            }
            console.warn(`exiftool ${tag}: empty extraction`);
        } catch (error) {
            // exiftool exits non-zero on unreadable input; treat like an
            // empty extraction and let the caller escalate — but never
            // silently: the reason is unrecoverable after the job completes.
            const e = error as NodeJS.ErrnoException & { stderr?: Buffer };
            console.warn(
                `exiftool ${tag} failed: ${e.code ?? ''} ${e.message}`,
                e.stderr ? e.stderr.toString('utf8').slice(0, 500) : ''
            );
        }
    }
    return null;
}

interface FfmpegResult {
    ok: boolean;
}

// ffmpeg exiting non-zero on media it was handed is a deterministic "bad
// file" verdict, not a transient failure — surface it as ok:false so the
// caller marks 'failed' instead of burning SQS retries. A missing binary
// (layer not attached) throws: that IS systemic and belongs in the DLQ.
async function runFfmpeg(args: string[]): Promise<FfmpegResult> {
    try {
        await execFileAsync(FFMPEG, ['-y', '-hide_banner', ...args]);
        return { ok: true };
    } catch (error) {
        const e = error as NodeJS.ErrnoException & { stderr?: string };
        if (e.code === 'ENOENT') throw error;
        console.warn(
            `ffmpeg exited non-zero: ${e.message}`,
            e.stderr ? e.stderr.slice(-500) : ''
        );
        return { ok: false };
    }
}

/**
 * Capture a single frame from `input` (local file or presigned URL), scaled
 * to fit the thumbnail edge, encoded as WebP.
 */
async function captureWebpFrame(
    input: string,
    output: string,
    seekSeconds = 0
): Promise<boolean> {
    const { ok } = await runFfmpeg([
        ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        SCALE_FILTER,
        '-c:v',
        'libwebp',
        '-quality',
        '80',
        output,
    ]);
    return ok;
}

async function probeDurationSeconds(url: string): Promise<number | null> {
    try {
        const { stdout } = await execFileAsync(FFPROBE, [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'csv=p=0',
            url,
        ]);
        const duration = Number.parseFloat(stdout.trim());
        return Number.isFinite(duration) ? duration : null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
        return null;
    }
}

// Null on probe failure rather than throwing: a bad probe of a webp we just
// wrote successfully must not turn a finished thumbnail into a DLQ retry.
// A missing binary still throws (systemic), matching probeDurationSeconds.
async function probeDimensions(
    filePath: string
): Promise<{ width: number; height: number } | null> {
    try {
        const { stdout } = await execFileAsync(FFPROBE, [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=width,height',
            '-of',
            'csv=s=x:p=0',
            filePath,
        ]);
        const match = stdout.trim().match(/^(\d+)x(\d+)/);
        if (!match) return null;
        return { width: Number(match[1]), height: Number(match[2]) };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
        return null;
    }
}

type GenerateOutcome =
    | { status: 'ready'; webpPath: string; durationSeconds: number | null }
    | { status: 'failed' }
    | { status: 'failed_cold' };

async function generateStill(
    file: File,
    kind: 'raw' | 'image',
    workDir: string
): Promise<GenerateOutcome> {
    const srcPath = path.join(workDir, 'source');
    const previewPath = path.join(workDir, 'preview.jpg');
    const webpPath = path.join(workDir, 'thumb.webp');

    try {
        if (kind === 'raw') {
            await downloadObject(
                file.s3Key,
                srcPath,
                `bytes=0-${RAW_HEAD_BYTES - 1}`
            );
        } else {
            await downloadObject(file.s3Key, srcPath);
        }
    } catch (error) {
        if (isInvalidObjectState(error)) return { status: 'failed_cold' };
        throw error;
    }

    let input: string | null = srcPath;
    if (kind === 'raw') {
        input = await extractRawPreview(srcPath, previewPath);
        if (!input && file.size > RAW_HEAD_BYTES) {
            // Preview not in the head — retry once against the full object.
            await downloadObject(file.s3Key, srcPath);
            input = await extractRawPreview(srcPath, previewPath);
        }
        if (!input) return { status: 'failed' };
    }

    const isScaled = await captureWebpFrame(input, webpPath);
    if (!isScaled) return { status: 'failed' };
    return { status: 'ready', webpPath, durationSeconds: null };
}

async function generateVideoPoster(
    file: File,
    workDir: string
): Promise<GenerateOutcome> {
    const webpPath = path.join(workDir, 'thumb.webp');

    // Cheap readability probe: ffmpeg reading a presigned URL can't
    // distinguish "archived" from "bad file", but a 1-byte GET can.
    try {
        await downloadObject(
            file.s3Key,
            path.join(workDir, 'probe'),
            'bytes=0-0'
        );
    } catch (error) {
        if (isInvalidObjectState(error)) return { status: 'failed_cold' };
        throw error;
    }

    // Presigned URL input: ffmpeg's https range seeks read the moov atom +
    // one GOP — a 4GB clip costs a few MB, nothing lands on /tmp.
    const url = await getSignedUrl(
        getS3(),
        new GetObjectCommand({
            Bucket: getBucket('S3_BUCKET'),
            Key: file.s3Key,
        }),
        { expiresIn: PRESIGN_EXPIRY_SECONDS }
    );

    const duration = await probeDurationSeconds(url);
    const seek =
        duration === null
            ? 0
            : Math.min(VIDEO_POSTER_SEEK_SECONDS, Math.max(duration - 0.5, 0));

    let isCaptured = await captureWebpFrame(url, webpPath, seek);
    if (!isCaptured && seek > 0) {
        // Seek past a short/odd stream yields no frame; first frame beats none.
        isCaptured = await captureWebpFrame(url, webpPath);
    }
    if (!isCaptured) return { status: 'failed' };

    return {
        status: 'ready',
        webpPath,
        durationSeconds: duration === null ? null : Math.round(duration),
    };
}

export async function generateThumbnail(
    ctx: HandlerContext<'generate-thumbnail'>
): Promise<void> {
    const { payload, db } = ctx;
    const fileRepo = createFileRepo(db);

    const file = await fileRepo.findById(payload.fileId);
    // The row can be gone or soft-deleted by the time the job runs; both are
    // success paths (job completes), not retries.
    if (!file) return;
    if (file.status === 'deleted') {
        await fileRepo.update(file.id, { thumbnailStatus: 'skipped' });
        return;
    }
    // Duplicate SQS delivery of an already-generated thumbnail.
    if (file.thumbnailStatus === 'ready') return;

    const kind = classifyMedia(file);
    if (!kind) {
        await fileRepo.update(file.id, { thumbnailStatus: 'skipped' });
        return;
    }

    const workDir = await mkdtemp(path.join(tmpdir(), 'thumb-'));
    try {
        const outcome =
            kind === 'video'
                ? await generateVideoPoster(file, workDir)
                : await generateStill(file, kind, workDir);

        if (outcome.status !== 'ready') {
            console.warn(
                `thumbnail ${outcome.status}: file=${file.id} kind=${kind}`
            );
            await fileRepo.update(file.id, { thumbnailStatus: outcome.status });
            return;
        }

        const dimensions = await probeDimensions(outcome.webpPath);

        // Invariant: the S3 write happens before the status flip, so a
        // 'ready' row always has a readable object behind it.
        await getS3().send(
            new PutObjectCommand({
                Bucket: getBucket('S3_DERIVED_BUCKET'),
                Key: thumbnailKey(file),
                Body: await readFile(outcome.webpPath),
                ContentType: 'image/webp',
            })
        );

        await fileRepo.update(file.id, {
            thumbnailStatus: 'ready',
            thumbnailWidth: dimensions?.width ?? null,
            thumbnailHeight: dimensions?.height ?? null,
            durationSeconds: outcome.durationSeconds,
        });
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

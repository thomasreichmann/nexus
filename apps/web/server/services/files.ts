import {
    createFileRepo,
    originalKey,
    thumbnailKey,
    type File,
} from '@nexus/db/repo/files';
import { createStorageUsageRepo } from '@nexus/db/repo/storage-usage';
import {
    createUploadBatchRepo,
    type UploadBatch,
} from '@nexus/db/repo/uploadBatches';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { s3 } from '@/lib/storage';
import { MULTIPART_CHUNK_SIZE } from '@/lib/upload/limits';
import { PostHogEvent } from '@/lib/posthog/events';
import { captureServerEvent } from '@/lib/posthog/server';
import { quotaService } from './quota';
import { enqueueThumbnailGeneration } from './thumbnails';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import type { DB } from '@nexus/db';

const PRESIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes
const MULTIPART_URL_EXPIRY_SECONDS = 3600; // 1 hour

interface UploadInput {
    name: string;
    sizeBytes: number;
    mimeType?: string;
    // When supplied, the file joins an existing batch (validated for ownership).
    // When absent, the service creates a single-file batch with a fallback name
    // so every new file has a batchId — keeps the s3Key shape uniform.
    batchId?: string;
    // Optional folder/session label. Falls back to a timestamp when omitted.
    batchName?: string;
}

// UTC and minute-precision so labels are deterministic across timezones.
export function formatFallbackBatchName(date: Date): string {
    const iso = date.toISOString();
    return `Upload ${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

// Single insert point for new batches; the name falls back to the timestamp
// label when the caller doesn't supply one.
async function insertBatch(
    db: DB,
    userId: string,
    name?: string
): Promise<UploadBatch> {
    const batchRepo = createUploadBatchRepo(db);
    return batchRepo.insert({
        id: crypto.randomUUID(),
        userId,
        name: name ?? formatFallbackBatchName(new Date()),
    });
}

async function resolveBatchId(
    db: DB,
    userId: string,
    input: UploadInput
): Promise<string> {
    if (input.batchId) {
        const batchRepo = createUploadBatchRepo(db);
        const existing = await batchRepo.findByUserAndId(userId, input.batchId);
        if (!existing) {
            throw new NotFoundError('UploadBatch', input.batchId);
        }
        return existing.id;
    }
    return (await insertBatch(db, userId, input.batchName)).id;
}

interface CreateBatchResult {
    batchId: string;
}

// Pre-create a session batch so every file in a multi-file upload joins the
// same batch (the per-file initiate calls pass this id back as input.batchId).
// `name` labels a whole-folder upload after its folder (#395).
async function createBatch(
    db: DB,
    userId: string,
    name?: string
): Promise<CreateBatchResult> {
    return { batchId: (await insertBatch(db, userId, name)).id };
}

interface InitiateUploadResult {
    fileId: string;
    uploadUrl: string;
    expiresAt: Date;
}

interface InitiateMultipartResult {
    fileId: string;
    uploadId: string;
    partUrls: string[];
    chunkSize: number;
    expiresAt: Date;
}

interface CompleteMultipartInput {
    fileId: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
}

interface CompleteMultipartResult {
    file: File;
}

interface ConfirmUploadResult {
    file: File;
}

async function initiateUpload(
    db: DB,
    userId: string,
    input: UploadInput,
    sub: Subscription | undefined
): Promise<InitiateUploadResult> {
    await quotaService.checkQuota(db, userId, input.sizeBytes, sub);

    const batchId = await resolveBatchId(db, userId, input);
    const fileRepo = createFileRepo(db);
    const fileId = crypto.randomUUID();
    const s3Key = originalKey({
        userId,
        batchId,
        id: fileId,
        name: input.name,
    });

    const uploadUrl = await s3.presigned.put(s3Key, {
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });

    await fileRepo.insert({
        id: fileId,
        userId,
        batchId,
        name: input.name,
        size: input.sizeBytes,
        mimeType: input.mimeType ?? null,
        s3Key,
        status: 'uploading',
    });

    const expiresAt = new Date(
        Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000
    );

    return {
        fileId,
        uploadUrl,
        expiresAt,
    };
}

async function confirmUpload(
    db: DB,
    userId: string,
    fileId: string
): Promise<ConfirmUploadResult> {
    const { file, isConfirmed } = await db.transaction(async (tx) => {
        const fileRepo = createFileRepo(tx);
        const usageRepo = createStorageUsageRepo(tx);

        // Only the call that wins the claim counts usage, so a duplicate
        // confirm can't double-count and a cancel that got there first isn't
        // overwritten. The loser is a no-op either way — it reports the row as
        // it now stands. Unlike a multipart complete, losing to a release
        // isn't an error here: the only release that can beat a single-part
        // confirm is the same tab's own cancel (no other tab knows the fileId,
        // and the stale reaper's 24h is far past the 15-minute PUT URL), and
        // that tab has already dropped the row.
        const claimed = await fileRepo.claimUpload(userId, fileId, 'available');
        if (!claimed) {
            const existing = await fileRepo.findByUserAndId(userId, fileId);
            if (!existing) {
                throw new NotFoundError('File', fileId);
            }
            return { file: existing, isConfirmed: false };
        }

        await usageRepo.incrementUsage(userId, claimed.size);

        return { file: claimed, isConfirmed: true };
    });

    // After the commit, and only on the branch that actually flipped state —
    // a duplicate confirm must not double-count in the funnel or re-enqueue
    // the thumbnail job.
    if (isConfirmed) {
        captureServerEvent(userId, PostHogEvent.UploadConfirmed, {
            fileId: file.id,
            sizeBytes: file.size,
            batchId: file.batchId,
        });
        await enqueueThumbnailGeneration(db, file.id);
    }

    return { file };
}

async function initiateMultipartUpload(
    db: DB,
    userId: string,
    input: UploadInput,
    sub: Subscription | undefined
): Promise<InitiateMultipartResult> {
    await quotaService.checkQuota(db, userId, input.sizeBytes, sub);

    const batchId = await resolveBatchId(db, userId, input);
    const fileRepo = createFileRepo(db);
    const fileId = crypto.randomUUID();
    const s3Key = originalKey({
        userId,
        batchId,
        id: fileId,
        name: input.name,
    });
    const partCount = Math.ceil(input.sizeBytes / MULTIPART_CHUNK_SIZE);

    const { uploadId } = await s3.multipart.create(s3Key, input.mimeType);

    const partUrls = await s3.multipart.signParts({
        key: s3Key,
        uploadId,
        partCount,
        expiresIn: MULTIPART_URL_EXPIRY_SECONDS,
    });

    await fileRepo.insert({
        id: fileId,
        userId,
        batchId,
        name: input.name,
        size: input.sizeBytes,
        mimeType: input.mimeType ?? null,
        s3Key,
        status: 'uploading',
    });

    const expiresAt = new Date(
        Date.now() + MULTIPART_URL_EXPIRY_SECONDS * 1000
    );

    return {
        fileId,
        uploadId,
        partUrls,
        chunkSize: MULTIPART_CHUNK_SIZE,
        expiresAt,
    };
}

async function completeMultipartUpload(
    db: DB,
    userId: string,
    input: CompleteMultipartInput
): Promise<CompleteMultipartResult> {
    // A fast fail before the slow S3 call, not the guard: the row can still
    // change under us until the claim below.
    const file = await loadResumableFile(db, userId, input.fileId);

    // S3 completion happens outside the transaction because it's slow,
    // network-bound, and not rollback-friendly. The DB write that follows
    // covers status flip and usage bump atomically.
    await s3.multipart.complete(file.s3Key, input.uploadId, input.parts);

    const { file: completed, isConfirmed } = await db.transaction(
        async (tx) => {
            const txFileRepo = createFileRepo(tx);
            const txUsageRepo = createStorageUsageRepo(tx);

            const claimed = await txFileRepo.claimUpload(
                userId,
                input.fileId,
                'available'
            );
            if (!claimed) {
                const current = await txFileRepo.findByUserAndId(
                    userId,
                    input.fileId
                );
                if (!current) {
                    throw new NotFoundError('File', input.fileId);
                }
                // Released while S3 was completing — a cancel in another tab,
                // or the stale-upload reaper. Reporting success would tell the
                // client a file is archived that no list will ever show.
                if (current.status === 'deleted') {
                    throw new InvalidStateError(
                        `File is not in uploading state: ${current.status}`
                    );
                }
                // A concurrent complete (two tabs resuming the same record)
                // already counted it.
                return { file: current, isConfirmed: false };
            }

            await txUsageRepo.incrementUsage(userId, claimed.size);

            return { file: claimed, isConfirmed: true };
        }
    );

    // Same post-commit, flip-branch-only enqueue as confirmUpload.
    if (isConfirmed) {
        await enqueueThumbnailGeneration(db, completed.id);
    }

    return { file: completed };
}

interface ListMultipartPartsResult {
    parts: { partNumber: number; etag: string; size: number }[];
}

interface SignMultipartPartsInput {
    fileId: string;
    uploadId: string;
    partNumbers: number[];
}

interface SignMultipartPartsResult {
    parts: { partNumber: number; url: string }[];
    expiresAt: Date;
}

// Complete and the resume helpers share an ownership + status guard: the
// caller must own the file and it must still be `uploading`. A file that
// already reached `available` (completed) or `deleted` (aborted) has no live
// multipart upload to reconcile against, so resuming it is a client bug, not a
// recoverable state.
async function loadResumableFile(
    db: DB,
    userId: string,
    fileId: string
): Promise<File> {
    const fileRepo = createFileRepo(db);
    const file = await fileRepo.findByUserAndId(userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }
    if (file.status !== 'uploading') {
        throw new InvalidStateError(
            `File is not in uploading state: ${file.status}`
        );
    }
    return file;
}

// Reconcile against S3: report which parts S3 has already received so the
// client can skip them on resume even when its local (IndexedDB) state is
// stale or lost. ETags come straight from S3 and feed back into `complete`.
async function listMultipartParts(
    db: DB,
    userId: string,
    fileId: string,
    uploadId: string
): Promise<ListMultipartPartsResult> {
    const file = await loadResumableFile(db, userId, fileId);
    const parts = await s3.multipart.listParts(file.s3Key, uploadId);
    return { parts };
}

// Re-presign a specific set of part numbers without restarting the upload.
// Used for the parts left to upload on resume, and to refresh URLs that
// expired mid-upload (part URLs live 1 hour).
async function signMultipartParts(
    db: DB,
    userId: string,
    input: SignMultipartPartsInput
): Promise<SignMultipartPartsResult> {
    const file = await loadResumableFile(db, userId, input.fileId);

    const parts = await s3.multipart.signPartsByNumber({
        key: file.s3Key,
        uploadId: input.uploadId,
        partNumbers: input.partNumbers,
        expiresIn: MULTIPART_URL_EXPIRY_SECONDS,
    });

    const expiresAt = new Date(
        Date.now() + MULTIPART_URL_EXPIRY_SECONDS * 1000
    );

    return { parts, expiresAt };
}

/**
 * Give up on an upload: close the row, then hand its S3 side to `release`.
 * The two engines differ only in that release step, so the parts that must not
 * drift between them live here.
 *
 * The claim is the load-bearing line, and it comes first. A row past
 * `uploading` has confirmed and been counted, so releasing it would delete the
 * bytes of a file the user now owns while leaving its usage incremented — and
 * a cancel click really can land just after the confirm it raced. Claiming
 * before touching S3 means a confirm that loses finds the row already
 * `deleted`, and one that wins leaves nothing for this call to delete (#381).
 * Losing is a no-op, which also makes a repeated release idempotent.
 *
 * The cost of that order: if `release` fails, the row is already `deleted`
 * and the bytes outlive it — orphaned until soft-deleted objects get reaped
 * (#307); multipart parts fall to the bucket's abort-incomplete lifecycle
 * rule. The reverse order risks a confirmed file with nothing behind it.
 *
 * No usage decrement anywhere: an upload that never confirmed was never
 * counted (`confirmUpload` is what increments).
 */
async function releaseUpload(
    db: DB,
    userId: string,
    fileId: string,
    release: (file: File) => Promise<void>
): Promise<void> {
    const fileRepo = createFileRepo(db);
    const claimed = await fileRepo.claimUpload(userId, fileId, 'deleted');
    if (!claimed) {
        if (!(await fileRepo.findByUserAndId(userId, fileId))) {
            throw new NotFoundError('File', fileId);
        }
        return;
    }

    await release(claimed);
}

function abortMultipartUpload(
    db: DB,
    userId: string,
    fileId: string,
    uploadId: string
): Promise<void> {
    return releaseUpload(db, userId, fileId, (file) =>
        s3.multipart.abort(file.s3Key, uploadId)
    );
}

// Release an upload the client gave up on — cancelled, cleared, or replaced by
// a retry. Takes no uploadId, unlike `abortMultipartUpload`: `initiateUpload`
// records `s3Key` on the row at insert, which is all a DeleteObject needs, so
// this serves the single-part engine (which never mints an uploadId) too.
// Without it a cancelled single-part upload leaves an `uploading` row that no
// list ever shows and bytes in S3 that nothing accounts for (#330).
function abandonUpload(db: DB, userId: string, fileId: string): Promise<void> {
    return releaseUpload(db, userId, fileId, (file) =>
        s3.objects.remove(file.s3Key)
    );
}

const THUMBNAIL_URL_EXPIRY_SECONDS = 3600; // 1 hour

interface ThumbnailUrlsResult {
    /** fileId -> presigned GET URL; only entries with a ready thumbnail. */
    urls: Record<string, string>;
    expiresAt: Date;
}

// Bulk-presign thumbnail GETs for the file browser. Presigning is local
// HMAC (~tens of µs/URL) — the input cap is about response payload size,
// not signing cost; the client chunks its visible files into page-sized
// batches. Files without a ready thumbnail (or an unconfigured derived
// bucket) are simply absent from the map: the UI keeps its icon fallback.
async function getThumbnailUrls(
    db: DB,
    userId: string,
    fileIds: string[]
): Promise<ThumbnailUrlsResult> {
    const urls: Record<string, string> = {};

    if (s3.derived.isConfigured()) {
        const fileRepo = createFileRepo(db);
        const files = await fileRepo.findManyByUserAndIds(userId, fileIds);
        const ready = files.filter((f) => f.thumbnailStatus === 'ready');
        await Promise.all(
            ready.map(async (f) => {
                urls[f.id] = await s3.derived.get(thumbnailKey(f), {
                    expiresIn: THUMBNAIL_URL_EXPIRY_SECONDS,
                });
            })
        );
    }

    return {
        urls,
        expiresAt: new Date(Date.now() + THUMBNAIL_URL_EXPIRY_SECONDS * 1000),
    };
}

function deleteUserFile(db: DB, userId: string, fileId: string): Promise<File>;
function deleteUserFile(
    db: DB,
    userId: string,
    fileIds: string[]
): Promise<File[]>;
async function deleteUserFile(
    db: DB,
    userId: string,
    fileIdOrIds: string | string[]
): Promise<File | File[]> {
    const fileIds = Array.isArray(fileIdOrIds) ? fileIdOrIds : [fileIdOrIds];
    if (fileIds.length === 0) return [];

    const deleted = await db.transaction(async (tx) => {
        const fileRepo = createFileRepo(tx);
        const usageRepo = createStorageUsageRepo(tx);

        // Pre-fetch so we know each file's pre-delete status. Only files that
        // ever reached `available` (or beyond) were counted in storage_usage —
        // decrementing for `uploading` files would drift usage negative.
        const before = await fileRepo.findManyByUserAndIds(userId, fileIds);

        const result = await fileRepo.softDeleteForUser(userId, fileIds);

        // If count doesn't match, some files were missing or not owned
        if (result.length !== fileIds.length) {
            const deletedIds = new Set(result.map((f) => f.id));
            const missingId = fileIds.find((id) => !deletedIds.has(id));
            throw new NotFoundError('File', missingId!);
        }

        // Aggregate counted bytes/count and issue a single UPDATE so a
        // full-archive delete doesn't fan out into N round-trips.
        const counted = before.filter((f) => f.status !== 'uploading');
        if (counted.length > 0) {
            const totalBytes = counted.reduce((sum, f) => sum + f.size, 0);
            await usageRepo.decrementUsage(userId, totalBytes, counted.length);
        }

        return result;
    });

    return Array.isArray(fileIdOrIds) ? deleted : deleted[0];
}

export const fileService = {
    createBatch,
    initiateUpload,
    confirmUpload,
    initiateMultipartUpload,
    completeMultipartUpload,
    listMultipartParts,
    signMultipartParts,
    abortMultipartUpload,
    abandonUpload,
    deleteUserFile,
    getThumbnailUrls,
} as const;

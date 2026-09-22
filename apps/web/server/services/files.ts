import {
    createFileRepo,
    originalKey,
    thumbnailKey,
    type File,
    type FileRepo,
} from '@nexus/db/repo/files';
import { createStorageUsageRepo } from '@nexus/db/repo/storage-usage';
import {
    createUploadBatchRepo,
    type UploadBatch,
} from '@nexus/db/repo/uploadBatches';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { s3 } from '@/lib/storage';
import { PostHogEvent } from '@/lib/posthog/events';
import { captureServerEvent } from '@/lib/posthog/server';
import { quotaService } from './quota';
import { enqueueThumbnailGeneration } from './thumbnails';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import type { DB } from '@nexus/db';

const PRESIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes
const MULTIPART_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
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

/**
 * The file, or `NotFoundError` if it's missing or someone else's. Every lost
 * `claimUploading` goes through here: the claim collapses three causes into
 * one `undefined` — missing, not the caller's, or already past `uploading` —
 * and only the last is a legitimate no-op. One extra read separates them, paid
 * only on the losing branch.
 */
async function requireOwnedFile(
    fileRepo: FileRepo,
    userId: string,
    fileId: string
): Promise<File> {
    const existing = await fileRepo.findByUserAndId(userId, fileId);
    if (!existing) {
        throw new NotFoundError('File', fileId);
    }
    return existing;
}

async function confirmUpload(
    db: DB,
    userId: string,
    fileId: string
): Promise<ConfirmUploadResult> {
    const { file, isConfirmed } = await db.transaction(async (tx) => {
        const fileRepo = createFileRepo(tx);
        const usageRepo = createStorageUsageRepo(tx);

        // Claim before counting: winning is what earns the increment, so
        // usage can only move once per file (see `claimUploading`, #381).
        const claimed = await fileRepo.claimUploading(
            userId,
            fileId,
            'available'
        );
        if (!claimed) {
            // Idempotency: a duplicate confirm, or one that lost to a cancel,
            // reports the file it found without double-counting usage.
            return {
                file: await requireOwnedFile(fileRepo, userId, fileId),
                isConfirmed: false,
            };
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
    const file = await loadResumableFile(db, userId, input.fileId);

    // S3 completion happens outside the transaction because it's slow,
    // network-bound, and not rollback-friendly. It also stays *before* the
    // claim, unlike the destructive S3 calls in `releaseUpload`: assembling
    // the object is what makes `available` true, and claiming first would let
    // a failed completion leave an `available` row with nothing behind it —
    // the very state #381 exists to prevent.
    await s3.multipart.complete(file.s3Key, input.uploadId, input.parts);

    const { file: completed, isConfirmed } = await db.transaction(
        async (tx) => {
            const txFileRepo = createFileRepo(tx);
            const txUsageRepo = createStorageUsageRepo(tx);

            // The guard above was only a fast path — a retry of this same
            // call, or a racing cancel, may have moved the row while S3 was
            // assembling the object. The claim is the real decision.
            const claimed = await txFileRepo.claimUploading(
                userId,
                input.fileId,
                'available'
            );
            if (!claimed) {
                return {
                    file: await requireOwnedFile(
                        txFileRepo,
                        userId,
                        input.fileId
                    ),
                    isConfirmed: false,
                };
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

// Every operation on a live multipart session shares an ownership + status
// guard: the caller must own the file and it must still be `uploading`. A file
// that already reached `available` (completed) or `deleted` (aborted) has no
// live multipart upload to reconcile against, so touching it is a client bug,
// not a recoverable state. This read is a fast path, not a decision — the
// transition itself is settled by `claimUploading` (#381).
async function loadResumableFile(
    db: DB,
    userId: string,
    fileId: string
): Promise<File> {
    const file = await requireOwnedFile(createFileRepo(db), userId, fileId);
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
 * Claiming the row is the load-bearing line, and it has to come first — see
 * `claimUploading` (#381). A row past `uploading` has confirmed and been
 * counted, so releasing it would delete the bytes of a file the user now owns;
 * winning the claim is what makes the object ours to delete. Losing it is a
 * no-op, which also makes a repeated release idempotent.
 *
 * The inversion trades one residue for another: if `release` throws, the row
 * is already `deleted` and its object survives, orphaned. That's the better
 * failure — it costs storage rather than destroying a file the user owns — but
 * note it is now invisible to `reap-stale-uploads`, which only queries rows
 * still in `uploading`. Collecting objects behind soft-deleted rows is #307.
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

    const claimed = await fileRepo.claimUploading(userId, fileId, 'deleted');
    if (!claimed) {
        // Still a 404 for a file that isn't there or isn't theirs; a row that
        // simply moved on is the idempotent no-op the docblock describes.
        await requireOwnedFile(fileRepo, userId, fileId);
        return;
    }

    await release(claimed);
}

// Abort inherits `releaseUpload`'s claim, which is where its own status guard
// comes from (#361): a confirmed file can't be aborted into `deleted`, so
// storage_usage can't be left counting bytes nothing will ever decrement.
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

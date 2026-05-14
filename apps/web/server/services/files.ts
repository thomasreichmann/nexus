import type { DB } from '@nexus/db';
import { createFileRepo, type File } from '@nexus/db/repo/files';
import { createStorageUsageRepo } from '@nexus/db/repo/storage-usage';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import { createUploadBatchRepo } from '@nexus/db/repo/uploadBatches';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { s3 } from '@/lib/storage';
import { quotaService } from './quota';

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

async function resolveBatchId(
    db: DB,
    userId: string,
    input: UploadInput
): Promise<string> {
    const batchRepo = createUploadBatchRepo(db);
    if (input.batchId) {
        const existing = await batchRepo.findByUserAndId(userId, input.batchId);
        if (!existing) {
            throw new NotFoundError('UploadBatch', input.batchId);
        }
        return existing.id;
    }
    const batch = await batchRepo.insert({
        id: crypto.randomUUID(),
        userId,
        name: input.batchName ?? formatFallbackBatchName(new Date()),
    });
    return batch.id;
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
    const s3Key = `${userId}/${batchId}/${fileId}/${input.name}`;

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
    return db.transaction(async (tx) => {
        const fileRepo = createFileRepo(tx);
        const usageRepo = createStorageUsageRepo(tx);

        const file = await fileRepo.findByUserAndId(userId, fileId);
        if (!file) {
            throw new NotFoundError('File', fileId);
        }
        // Idempotency: a duplicate confirm shouldn't double-count usage.
        // Only flip state and increment when the file is still uploading.
        if (file.status !== 'uploading') {
            return { file };
        }

        const updated = await fileRepo.update(fileId, {
            status: 'available',
        });
        if (!updated) {
            throw new NotFoundError('File', fileId);
        }

        await usageRepo.incrementUsage(userId, file.size);

        return { file: updated };
    });
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
    const s3Key = `${userId}/${batchId}/${fileId}/${input.name}`;
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
    const fileRepo = createFileRepo(db);
    const file = await fileRepo.findByUserAndId(userId, input.fileId);
    if (!file) {
        throw new NotFoundError('File', input.fileId);
    }
    if (file.status !== 'uploading') {
        throw new InvalidStateError(
            `File is not in uploading state: ${file.status}`
        );
    }

    // S3 completion happens outside the transaction because it's slow,
    // network-bound, and not rollback-friendly. The DB write that follows
    // covers status flip and usage bump atomically.
    await s3.multipart.complete(file.s3Key, input.uploadId, input.parts);

    return db.transaction(async (tx) => {
        const txFileRepo = createFileRepo(tx);
        const txUsageRepo = createStorageUsageRepo(tx);

        // Idempotency guard inside the txn: a retry after S3 success could
        // re-enter here with the file already 'available'. Re-fetch under the
        // tx and short-circuit so we don't double-increment usage.
        const current = await txFileRepo.findByUserAndId(userId, input.fileId);
        if (!current) {
            throw new NotFoundError('File', input.fileId);
        }
        if (current.status !== 'uploading') {
            return { file: current };
        }

        const updated = await txFileRepo.update(input.fileId, {
            status: 'available',
        });
        if (!updated) {
            throw new NotFoundError('File', input.fileId);
        }

        await txUsageRepo.incrementUsage(userId, file.size);

        return { file: updated };
    });
}

async function abortMultipartUpload(
    db: DB,
    userId: string,
    fileId: string,
    uploadId: string
): Promise<void> {
    const fileRepo = createFileRepo(db);
    const file = await fileRepo.findByUserAndId(userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    await s3.multipart.abort(file.s3Key, uploadId);

    // Aborted uploads never made it to `available`, so usage was never
    // incremented — no decrement needed here.
    await fileRepo.update(fileId, {
        status: 'deleted',
        deletedAt: new Date(),
    });
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
        // batch delete (up to 100 files) doesn't fan out into N round-trips.
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
    initiateUpload,
    confirmUpload,
    initiateMultipartUpload,
    completeMultipartUpload,
    abortMultipartUpload,
    deleteUserFile,
} as const;

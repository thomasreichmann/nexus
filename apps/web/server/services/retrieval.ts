import type { DB } from '@nexus/db';
import { createFileRepo, type File } from '@nexus/db/repo/files';
import { createRetrievalRepo, type Retrieval } from '@nexus/db/repo/retrievals';
import { createUploadBatchRepo } from '@nexus/db/repo/uploadBatches';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { s3 } from '@/lib/storage';
// Value import from ./types (not the package root) so unit tests that mock
// '@/lib/storage' don't erase the constant.
import { DEFAULT_RESTORE_DAYS_TO_KEEP } from '@/lib/storage/types';
import type { RestoreTier } from '@/lib/storage';

const DOWNLOAD_URL_EXPIRY_SECONDS = 3600; // 1 hour

// `batchId` is stamped on every new row so batch-level progress can be
// queried later; bulk callers pass null.
async function restoreFiles(
    db: DB,
    userId: string,
    files: File[],
    tier: RestoreTier,
    batchId: string | null
): Promise<Retrieval[]> {
    const retrievalRepo = createRetrievalRepo(db);
    const fileIds = files.map((f) => f.id);

    const existingRetrievals = await retrievalRepo.findByFileIds(fileIds);
    const existingFileIds = new Set(existingRetrievals.map((r) => r.fileId));
    const filesToRestore = files.filter((f) => !existingFileIds.has(f.id));

    const unavailableFile = filesToRestore.find(
        (f) => f.status !== 'available'
    );
    if (unavailableFile) {
        throw new InvalidStateError(
            `File is not available for retrieval (current status: ${unavailableFile.status})`
        );
    }

    if (filesToRestore.length === 0) {
        return existingRetrievals;
    }

    // Standard-class objects are downloadable as-is — RestoreObject would
    // fail with InvalidObjectState — so they skip S3 and become ready
    // immediately, entering the same download-window state as completed
    // Deep Archive restores.
    const archivedFiles = filesToRestore.filter(
        (f) => f.storageTier !== 'standard'
    );
    const standardFiles = filesToRestore.filter(
        (f) => f.storageTier === 'standard'
    );

    if (archivedFiles.length > 0) {
        await s3.glacier.restoreMany(
            archivedFiles.map((f) => f.s3Key),
            tier,
            DEFAULT_RESTORE_DAYS_TO_KEEP
        );
    }

    // Standard items get a synthetic window the same length as the real S3
    // restore window, so both tiers present the same ready/expiry state. It
    // is a UI concept for them — no S3 expiry event will ever fire.
    const now = new Date();
    const readyWindowEnd = new Date(
        now.getTime() + DEFAULT_RESTORE_DAYS_TO_KEEP * 24 * 60 * 60 * 1000
    );
    const newRetrievals = await retrievalRepo.insertMany([
        ...archivedFiles.map((f) => ({
            id: crypto.randomUUID(),
            fileId: f.id,
            userId,
            batchId,
            tier,
            status: 'pending' as const,
            initiatedAt: now,
        })),
        ...standardFiles.map((f) => ({
            id: crypto.randomUUID(),
            fileId: f.id,
            userId,
            batchId,
            tier,
            status: 'ready' as const,
            initiatedAt: now,
            readyAt: now,
            expiresAt: readyWindowEnd,
        })),
    ]);

    return [...existingRetrievals, ...newRetrievals];
}

async function requestRetrieval(
    db: DB,
    userId: string,
    fileId: string,
    tier: RestoreTier = 'standard'
): Promise<Retrieval> {
    const retrievals = await requestBulkRetrieval(db, userId, [fileId], tier);
    return retrievals[0];
}

async function requestBulkRetrieval(
    db: DB,
    userId: string,
    fileIds: string[],
    tier: RestoreTier = 'standard'
): Promise<Retrieval[]> {
    const fileRepo = createFileRepo(db);

    const files = await fileRepo.findManyByUserAndIds(userId, fileIds);
    if (files.length !== fileIds.length) {
        const foundIds = new Set(files.map((f) => f.id));
        const missingId = fileIds.find((id) => !foundIds.has(id));
        throw new NotFoundError('File', missingId!);
    }

    return restoreFiles(db, userId, files, tier, null);
}

async function findOwnedBatchFiles(
    db: DB,
    userId: string,
    batchId: string
): Promise<File[]> {
    const batchRepo = createUploadBatchRepo(db);
    const batch = await batchRepo.findByUserAndId(userId, batchId);
    if (!batch) {
        throw new NotFoundError('UploadBatch', batchId);
    }

    const fileRepo = createFileRepo(db);
    return fileRepo.findByUserAndBatch(userId, batchId);
}

async function requestBatchRetrieval(
    db: DB,
    userId: string,
    batchId: string,
    tier: RestoreTier = 'standard'
): Promise<Retrieval[]> {
    const files = await findOwnedBatchFiles(db, userId, batchId);
    if (files.length === 0) {
        throw new InvalidStateError('Batch contains no files');
    }

    return restoreFiles(db, userId, files, tier, batchId);
}

export interface BatchRetrievalStatus {
    totalFiles: number;
    readyFiles: number;
    isReady: boolean;
}

// A batch is ready only when every file in it has a ready retrieval —
// all-or-nothing, paced by the slowest item. Readiness is computed over the
// batch's files rather than batch-stamped retrieval rows: a file retrieved
// individually before the batch request keeps its existing row (batchId
// null), and it must still count.
async function getBatchRetrievalStatus(
    db: DB,
    userId: string,
    batchId: string
): Promise<BatchRetrievalStatus> {
    const files = await findOwnedBatchFiles(db, userId, batchId);

    const retrievalRepo = createRetrievalRepo(db);
    const retrievals = await retrievalRepo.findByFileIds(
        files.map((f) => f.id)
    );
    const readyFileIds = new Set(
        retrievals.filter((r) => r.status === 'ready').map((r) => r.fileId)
    );

    const readyFiles = files.filter((f) => readyFileIds.has(f.id)).length;

    return {
        totalFiles: files.length,
        readyFiles,
        isReady: files.length > 0 && readyFiles === files.length,
    };
}

interface DownloadUrlResult {
    url: string;
    expiresAt: Date;
}

async function getDownloadUrl(
    db: DB,
    userId: string,
    fileId: string
): Promise<DownloadUrlResult> {
    const fileRepo = createFileRepo(db);
    const retrievalRepo = createRetrievalRepo(db);

    const file = await fileRepo.findByUserAndId(userId, fileId);
    if (!file) {
        throw new NotFoundError('File', fileId);
    }

    const retrieval = await retrievalRepo.findByFileId(fileId);
    if (!retrieval || retrieval.status !== 'ready') {
        throw new InvalidStateError('File retrieval is not ready for download');
    }

    const url = await s3.presigned.get(file.s3Key, {
        expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
        filename: file.name,
    });

    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000);

    return { url, expiresAt };
}

export const retrievalService = {
    requestRetrieval,
    requestBulkRetrieval,
    requestBatchRetrieval,
    getBatchRetrievalStatus,
    getDownloadUrl,
} as const;

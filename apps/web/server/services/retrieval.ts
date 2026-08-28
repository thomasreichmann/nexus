import {
    createFileRepo,
    HIDDEN_STATUSES,
    type File,
} from '@nexus/db/repo/files';
import { createRetrievalRepo, type Retrieval } from '@nexus/db/repo/retrievals';
import {
    createRetrievalRequestRepo,
    type NewRetrievalRequest,
    type RetrievalRequestReadiness,
    type RetrievalRequestRepo,
} from '@nexus/db/repo/retrievalRequests';
import { createUploadBatchRepo } from '@nexus/db/repo/uploadBatches';
import {
    DEFAULT_RESTORE_TIER,
    isObjectMissing,
    isReadable,
} from '@nexus/db/objectState';
import { jobs } from '@/lib/jobs';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { logger } from '@/server/lib/logger';
import { s3 } from '@/lib/storage';
import type { ObjectState, RestoreTier } from '@/lib/storage';
import type { DB } from '@nexus/db';

const log = logger.child({ service: 'retrieval' });

const DOWNLOAD_URL_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * What a restore request answers with, now that asking S3 is a worker job
 * (#423). The request path settles ownership, eligibility and the retrieval
 * rows — everything a synchronous answer can honestly cover — and the HEAD +
 * `RestoreObject` fan-out happens after it returns, so a per-file started/failed
 * split is no longer a thing this call could know. Per-file outcomes reach the
 * user through the file list's status, the same rail that already reports a
 * restore failing hours later in the poll.
 *
 * `requestId` identifies the restore itself (#422) — the handle everything
 * downstream (readiness, zips, notification) hangs off. `fileCount` is what the
 * user asked for, including files a restore already in flight covers.
 */
export interface RetrievalRequestResult {
    requestId: string;
    fileCount: number;
}

/**
 * Writes the request together with its file set, once every requested file has
 * a retrieval row behind it. Deliberately last: a request that throws part-way
 * leaves no empty request behind, and the retrieval rows it did create are
 * adopted by the next request over those files.
 *
 * One item per requested file, whatever covers it — a row this call inserted,
 * one it adopted from a restore already in flight, or one whose earlier restore
 * failed. The item set is what the user asked for and never changes, which is
 * what makes request readiness countable: the retrieval row behind a file can
 * be shared with another request, lapse, or be re-created.
 */
async function recordRequest(
    requestRepo: RetrievalRequestRepo,
    request: NewRetrievalRequest,
    files: File[],
    retrievals: Retrieval[]
): Promise<void> {
    await requestRepo.insert(request);

    const retrievalIdByFileId = new Map(
        retrievals.map((r) => [r.fileId, r.id])
    );
    await requestRepo.insertItems(
        files.map((file) => ({
            id: crypto.randomUUID(),
            requestId: request.id,
            fileId: file.id,
            retrievalId: retrievalIdByFileId.get(file.id) ?? null,
        }))
    );
}

// `uploadBatchId` records how the file set was selected, when that was a whole
// upload batch; ad-hoc selections pass null. It lands on the request, not on
// the retrieval rows — a batch is a selection mechanism, never the identity of
// the restore (#422).
async function restoreFiles(
    db: DB,
    userId: string,
    files: File[],
    tier: RestoreTier,
    uploadBatchId: string | null
): Promise<RetrievalRequestResult> {
    const retrievalRepo = createRetrievalRepo(db);
    const requestRepo = createRetrievalRequestRepo(db);
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

    // The identity of this restore. Minted here so both exits below name the
    // same request, but only written once every file has a row — including
    // rows this call merely adopts, which is the case the upload-batch stamp
    // could never express.
    const request: NewRetrievalRequest = {
        id: crypto.randomUUID(),
        userId,
        uploadBatchId,
        tier,
    };

    // Every file is already covered by a restore in flight; there is nothing
    // for the job to ask S3 about, so none is published.
    if (filesToRestore.length === 0) {
        await recordRequest(requestRepo, request, files, existingRetrievals);
        return { requestId: request.id, fileCount: files.length };
    }

    // A lapsed `ready` row is invisible to findByFileIds but still holds the
    // unique-index slot for its file; expire it or the insert below would
    // conflict against a row that no longer counts as active.
    const fileIdsToRestore = filesToRestore.map((f) => f.id);
    await retrievalRepo.expireLapsedByFileIds(fileIdsToRestore);

    // Rows are written before any RestoreObject call (#329): a restore that
    // succeeds without a row is a paid, invisible restore that nothing will
    // ever reconcile. Moving the fan-out to a worker widened the window that
    // rule guards from one function call to a queue hop, so the whole file set
    // lands in one INSERT here, before a job exists to restore any of it.
    //
    // Every row starts `pending`, including files whose object turns out to be
    // warm: whether S3 can serve the bytes is S3's answer to give (#416), and
    // the job's HEAD is where it gets asked. `initiatedAt` still marks when the
    // request was accepted — the horizon the readiness poll measures from wants
    // a conservative lower bound, and accept-time is one.
    const now = new Date();
    const newRetrievals = await retrievalRepo.insertMany(
        filesToRestore.map((file) => ({
            id: crypto.randomUUID(),
            fileId: file.id,
            userId,
            tier,
            status: 'pending' as const,
            initiatedAt: now,
        }))
    );

    // A concurrent request may have won the insert for some files (the unique
    // index skips them via ON CONFLICT DO NOTHING); find the surviving rows so
    // every requested file still maps to a retrieval. The winner's own job
    // restores them — this request's job HEADs them, sees `restoring`, and
    // leaves them alone.
    const adopted: Retrieval[] = [];
    if (newRetrievals.length < filesToRestore.length) {
        const insertedFileIds = new Set(newRetrievals.map((r) => r.fileId));
        const conflictedFileIds = fileIdsToRestore.filter(
            (id) => !insertedFileIds.has(id)
        );
        adopted.push(...(await retrievalRepo.findByFileIds(conflictedFileIds)));

        // The active-filtered lookup misses a winner whose restore already
        // failed (`failed` is outside the active predicate). The item still
        // points at that row: a request whose file has no live restore behind
        // it must read as not-ready, not as a file nobody ever asked for.
        const adoptedFileIds = new Set(adopted.map((r) => r.fileId));
        for (const fileId of conflictedFileIds) {
            if (adoptedFileIds.has(fileId)) continue;
            const latest = await retrievalRepo.findLatestByFileId(fileId);
            if (!latest) {
                log.warn(
                    { fileId },
                    'Insert conflicted but no retrieval row found for file'
                );
                continue;
            }
            adopted.push(latest);
        }
    }

    await recordRequest(requestRepo, request, files, [
        ...existingRetrievals,
        ...newRetrievals,
        ...adopted,
    ]);

    // Deliberately not swallowed the way enqueueThumbnailGeneration is: a
    // restore nobody was told to start is a request that would sit `pending`
    // until the stuck-retrieval check notices, and the user has no way to know.
    // Failing the mutation lets them retry, and the retry adopts the rows this
    // call already wrote.
    await jobs.publish(db, {
        type: 'initiate-restore',
        payload: { requestId: request.id },
    });

    return { requestId: request.id, fileCount: files.length };
}

function requestRetrieval(
    db: DB,
    userId: string,
    fileId: string,
    tier: RestoreTier = DEFAULT_RESTORE_TIER
): Promise<RetrievalRequestResult> {
    return requestBulkRetrieval(db, userId, [fileId], tier);
}

async function requestBulkRetrieval(
    db: DB,
    userId: string,
    fileIds: string[],
    tier: RestoreTier = DEFAULT_RESTORE_TIER
): Promise<RetrievalRequestResult> {
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
    tier: RestoreTier = DEFAULT_RESTORE_TIER
): Promise<RetrievalRequestResult> {
    const files = await findOwnedBatchFiles(db, userId, batchId);
    if (files.length === 0) {
        throw new InvalidStateError('Batch contains no files');
    }

    return restoreFiles(db, userId, files, tier, batchId);
}

/**
 * Readiness of one restore, keyed on the request the user actually made.
 *
 * Replaces the upload-batch-keyed predecessor (#371, #422): a batch is one way
 * of selecting files, and keying readiness on it could describe neither a
 * multi-select restore nor two restores over the same batch. The all-or-nothing
 * rule is unchanged — the request is ready when its last file thaws.
 */
async function getRequestStatus(
    db: DB,
    userId: string,
    requestId: string
): Promise<RetrievalRequestReadiness> {
    const requestRepo = createRetrievalRequestRepo(db);

    // Ownership first: the readiness count itself is not user-scoped, so
    // another user's request has to be indistinguishable from a missing one.
    const request = await requestRepo.findByUserAndId(userId, requestId);
    if (!request) {
        throw new NotFoundError('RetrievalRequest', requestId);
    }

    return requestRepo.findReadiness(requestId);
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

    const file = await fileRepo.findByUserAndId(userId, fileId);
    // S3 owns warm/cold, but `uploading` and `deleted` are DB-owned intent:
    // the bytes may sit warm in the bucket (soft delete never removes them;
    // sub-lifecycle-floor objects never go cold) while the file doesn't exist
    // as far as the user can see. Same not-found as every list that hides them.
    if (!file || HIDDEN_STATUSES.includes(file.status)) {
        throw new NotFoundError('File', fileId);
    }

    // Whether the bytes can be served is a question for S3, not for a row
    // that hopes to know (#416). A warm or already-restored object downloads
    // directly; a cold one does not, however `ready` its retrieval looks.
    let state: ObjectState;
    try {
        state = await s3.glacier.getObjectState(file.s3Key);
    } catch (err) {
        // The object is gone while the row still says otherwise — a delete
        // outside the app, a lifecycle expiry, or seed data whose keys were
        // never in the bucket. That is the same not-found the caller gets for
        // a missing row: only a DomainError reaches the client as anything
        // other than INTERNAL_SERVER_ERROR (see errorHandlerMiddleware).
        if (isObjectMissing(err)) throw new NotFoundError('File', fileId);
        throw err;
    }
    if (!isReadable(state)) {
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
    getRequestStatus,
    getDownloadUrl,
} as const;

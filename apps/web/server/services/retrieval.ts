import * as Sentry from '@sentry/nextjs';
import {
    createFileRepo,
    HIDDEN_STATUSES,
    type File,
} from '@nexus/db/repo/files';
import {
    createRetrievalRepo,
    type Retrieval,
    type RetrievalRepo,
} from '@nexus/db/repo/retrievals';
import {
    createRetrievalRequestRepo,
    type NewRetrievalRequest,
    type RetrievalRequestReadiness,
    type RetrievalRequestRepo,
} from '@nexus/db/repo/retrievalRequests';
import { createUploadBatchRepo } from '@nexus/db/repo/uploadBatches';
import {
    isObjectMissing,
    isReadable,
    restoreWindowEnd,
} from '@nexus/db/objectState';
import { createSemaphore } from '@/lib/async/semaphore';
import { toErrorMessage } from '@/lib/errors';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { logger } from '@/server/lib/logger';
import { s3 } from '@/lib/storage';
// Value import from ./types (not the package root) so unit tests that mock
// '@/lib/storage' don't erase the constant.
import { DEFAULT_RESTORE_DAYS_TO_KEEP } from '@/lib/storage/types';
import type { ObjectState, RestoreTier } from '@/lib/storage';
import type { DB } from '@nexus/db';

const log = logger.child({ service: 'retrieval' });

const DOWNLOAD_URL_EXPIRY_SECONDS = 3600; // 1 hour

/** Parallel HeadObject calls per retrieval request. */
const HEAD_CONCURRENCY = 12;

/**
 * A retrieval request that reaches S3 can come back partly failed (#329),
 * and the split is the result — callers can't read a success past it the
 * way they could a flat row array with `failed` statuses buried inside.
 * `started` holds every row now tracking an active restore, including rows
 * that already existed or that a concurrent request inserted first.
 *
 * `requestId` identifies the restore itself (#422) — the handle everything
 * downstream (readiness, zips, notification) hangs off, and the only one that
 * survives the per-row detail above.
 */
export interface RetrievalRequestResult {
    requestId: string;
    started: Retrieval[];
    failed: Retrieval[];
}

/**
 * Writes the request together with its file set, once the outcome of every
 * requested file is known. Deliberately last: a restore that throws part-way
 * leaves no empty request behind, and the retrieval rows it did create are
 * adopted by the next request over those files.
 *
 * One item per requested file, whatever became of it — a row this call
 * inserted, one it adopted from a restore already in flight, one whose restore
 * failed, or none at all. The item set is what the user asked for and never
 * changes, which is what makes request readiness countable: the retrieval row
 * behind a file can be shared with another request, lapse, or be re-created.
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
    // same request, but only written once their outcome is known — including
    // for rows this call merely adopts, which is the case the upload-batch
    // stamp could never express.
    const request: NewRetrievalRequest = {
        id: crypto.randomUUID(),
        userId,
        uploadBatchId,
        tier,
    };

    if (filesToRestore.length === 0) {
        await recordRequest(requestRepo, request, files, existingRetrievals);
        return {
            requestId: request.id,
            started: existingRetrievals,
            failed: [],
        };
    }

    // A lapsed `ready` row is invisible to findByFileIds but still holds the
    // unique-index slot for its file; expire it or the insert below would
    // conflict against a row that no longer counts as active.
    const fileIdsToRestore = filesToRestore.map((f) => f.id);
    await retrievalRepo.expireLapsedByFileIds(fileIdsToRestore);

    // One HeadObject per file: S3 owns object state, so the warm/cold split is
    // read at request time rather than from a column that mirrors it (#416).
    // A HEAD has no side effects, so asking before the inserts preserves
    // #329's rule that no RestoreObject fires without a row already behind it.
    // Bounded: a batch retrieve is a whole shoot, not the 100-file cap the
    // bulk endpoint enforces, and an unbounded fan-out from one serverless
    // invocation is the shape this issue exists to stop doing.
    const heads = createSemaphore(HEAD_CONCURRENCY);
    const plans = await Promise.all(
        filesToRestore.map(async (file) => {
            let state: ObjectState;
            try {
                state = await heads.run(() =>
                    s3.glacier.getObjectState(file.s3Key)
                );
            } catch (err) {
                // Fall through as archived rather than failing the request
                // here: the RestoreObject below will hit the same problem and
                // record it per-row, instead of inventing a second failure
                // path that reports the same outage differently.
                log.warn(
                    { err, fileId: file.id },
                    'HeadObject failed; treating object as archived'
                );
                state = { availability: 'archived' };
            }
            return { file, state };
        })
    );

    // Rows are written before any RestoreObject call (#329): a restore that
    // succeeds without a row is a paid, invisible restore that nothing will
    // ever reconcile. `initiatedAt` therefore marks when the request was
    // accepted, a moment before AWS hears about it.
    //
    // A readable object gets a `ready` row straight away. Warm objects take a
    // synthetic window the same length as a real restore window so both
    // present one download-window state to the UI; an already-restored object
    // uses the expiry S3 actually reported.
    const now = new Date();
    const syntheticWindowEnd = restoreWindowEnd(now);
    const newRetrievals = await retrievalRepo.insertMany(
        plans.map(({ file, state }) => {
            const base = {
                id: crypto.randomUUID(),
                fileId: file.id,
                userId,
                tier,
                initiatedAt: now,
            };
            if (isReadable(state)) {
                return {
                    ...base,
                    status: 'ready' as const,
                    readyAt: now,
                    expiresAt: state.expiresAt ?? syntheticWindowEnd,
                };
            }
            return { ...base, status: 'pending' as const };
        })
    );

    // Only genuinely archived objects get a RestoreObject. A restore already
    // in flight is left alone — S3 rejects a duplicate request for one, and
    // the worker's poll observes its completion either way.
    const keysToRestore = new Map(
        plans
            .filter(({ state }) => state.availability === 'archived')
            .map(({ file }) => [file.id, file.s3Key])
    );

    // A concurrent request may have won the insert for some files (the
    // unique index skips them via ON CONFLICT DO NOTHING); fetch the
    // surviving rows so every requested file still maps to a retrieval.
    // Only the rows this call inserted get a RestoreObject below — the
    // winner of the race is already restoring the files it took.
    const survivors: Retrieval[] = [];
    const failedSurvivors: Retrieval[] = [];
    if (newRetrievals.length < filesToRestore.length) {
        const insertedFileIds = new Set(newRetrievals.map((r) => r.fileId));
        const conflictedFileIds = fileIdsToRestore.filter(
            (id) => !insertedFileIds.has(id)
        );
        survivors.push(
            ...(await retrievalRepo.findByFileIds(conflictedFileIds))
        );

        // The active-filtered lookup misses a winner whose restore already
        // failed (`failed` is outside the active predicate). Those files
        // must land in `failed`, not silently in neither bucket — the
        // caller would otherwise toast success for a file with no restore
        // in flight.
        const survivorFileIds = new Set(survivors.map((r) => r.fileId));
        for (const fileId of conflictedFileIds) {
            if (survivorFileIds.has(fileId)) continue;
            const latest = await retrievalRepo.findLatestByFileId(fileId);
            if (!latest) {
                log.warn(
                    { fileId },
                    'Insert conflicted but no retrieval row found for file'
                );
                continue;
            }
            if (latest.status === 'failed') failedSurvivors.push(latest);
            else survivors.push(latest);
        }
    }

    const { started, failed } = await restoreInserted(
        retrievalRepo,
        newRetrievals,
        keysToRestore,
        tier
    );

    // Every bucket, not just the successful ones: only the ids matter here,
    // and taking the failed rows from the raw arrays — rather than from the
    // `errorMessage`-stripped copies the return builds — keeps every requested
    // file covered by an item.
    await recordRequest(requestRepo, request, files, [
        ...existingRetrievals,
        ...started,
        ...survivors,
        ...failed,
        ...failedSurvivors,
    ]);

    return {
        requestId: request.id,
        started: [...existingRetrievals, ...started, ...survivors],
        // `errorMessage` holds raw AWS SDK text (ARNs, account ids, bucket
        // names) for operators; it stays in the DB but must not reach the
        // client — the mutation payload has no output schema to strip it.
        failed: [...failed, ...failedSurvivors].map((row) => ({
            ...row,
            errorMessage: null,
        })),
    };
}

// One RestoreObject per file rather than a `Promise.all` over the whole
// batch: a batch-wide reject is unattributable, so a single bad key would
// leave every sibling row `pending` for a restore that did fire. Each
// failure is caught and written to its own row, which frees that file's
// active-unique-index slot (`failed` is outside the predicate) so a retry
// can insert cleanly.
async function restoreInserted(
    retrievalRepo: RetrievalRepo,
    newRetrievals: Retrieval[],
    keysToRestore: Map<string, string>,
    tier: RestoreTier
): Promise<Omit<RetrievalRequestResult, 'requestId'>> {
    const outcomes = await Promise.all(
        newRetrievals.map(async (retrieval) => {
            const s3Key = keysToRestore.get(retrieval.fileId);
            // Rows for readable or already-restoring objects never hit S3.
            if (!s3Key) return { ok: true, row: retrieval };

            try {
                await s3.glacier.restore(
                    s3Key,
                    tier,
                    DEFAULT_RESTORE_DAYS_TO_KEEP
                );
                return { ok: true, row: retrieval };
            } catch (err) {
                // The pre-#329 batch-wide throw surfaced restore failures
                // through the logging middleware and Sentry; caught-per-file
                // failures must stay as loud, or a total restore outage is
                // visible only as rows in a DB column.
                log.error(
                    {
                        err,
                        fileId: retrieval.fileId,
                        retrievalId: retrieval.id,
                    },
                    'S3 restore request failed'
                );
                Sentry.captureException(err);

                let failed: Retrieval | undefined;
                try {
                    failed = await retrievalRepo.updateStatus(
                        retrieval.id,
                        'failed',
                        {
                            failedAt: new Date(),
                            errorMessage: toErrorMessage(err),
                        }
                    );
                } catch (updateErr) {
                    // A failed failure-write must not reject the whole batch
                    // and discard sibling restores that already fired. The
                    // row stays `pending` (the stuck-retrieval health check
                    // flags it), but the caller still hears `failed`.
                    log.error(
                        { err: updateErr, retrievalId: retrieval.id },
                        'Failed to mark retrieval failed after restore error'
                    );
                    Sentry.captureException(updateErr);
                }
                return { ok: false, row: failed ?? retrieval };
            }
        })
    );

    return {
        started: outcomes.filter((o) => o.ok).map((o) => o.row),
        failed: outcomes.filter((o) => !o.ok).map((o) => o.row),
    };
}

function requestRetrieval(
    db: DB,
    userId: string,
    fileId: string,
    tier: RestoreTier = 'standard'
): Promise<RetrievalRequestResult> {
    return requestBulkRetrieval(db, userId, [fileId], tier);
}

async function requestBulkRetrieval(
    db: DB,
    userId: string,
    fileIds: string[],
    tier: RestoreTier = 'standard'
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
    tier: RestoreTier = 'standard'
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

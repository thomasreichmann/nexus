import {
    createFileRepo,
    HIDDEN_STATUSES,
    type File,
} from '@nexus/db/repo/files';
import { createRetrievalRepo, type Retrieval } from '@nexus/db/repo/retrievals';
import {
    createRetrievalRequestRepo,
    type DownloadableRequest,
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
import { PostHogEvent } from '@/lib/posthog/events';
import { captureServerEvent } from '@/lib/posthog/server';
import { s3 } from '@/lib/storage';
// Value import from ./types (not the package root) so unit tests that mock
// '@/lib/storage' don't erase the constants.
import {
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    ZIP_BUILD_RESTORE_DAYS,
    artifactWindowEnd,
    isDeliveredAsZip,
    isProbablyCold,
} from '@/lib/storage/types';
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
        captureRequested(request, files, 0);
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
    //
    // A multi-file restore is delivered as zip artifacts whose own lifecycle
    // rule owns how long the user can download them, so the thawed originals
    // only have to outlive the build (#424). One file is downloaded directly
    // from the restored copy, so that window is the user-facing one. The whole
    // request shares one window, warm files included: a mixed set would let
    // some rows lapse out of the ready predicate while their siblings are
    // still readable, and the zip needs all of them at once.
    const daysToKeep = isDeliveredAsZip(files.length)
        ? ZIP_BUILD_RESTORE_DAYS
        : DEFAULT_RESTORE_DAYS_TO_KEEP;

    const now = new Date();
    const newRetrievals = await retrievalRepo.insertMany(
        filesToRestore.map((file) => ({
            id: crypto.randomUUID(),
            fileId: file.id,
            userId,
            tier,
            status: 'pending' as const,
            initiatedAt: now,
            restoreDaysToKeep: daysToKeep,
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

    captureRequested(request, files, filesToRestore.length);

    return { requestId: request.id, fileCount: files.length };
}

/**
 * The opening half of the request lifecycle #426 instruments, paired with the
 * worker's `retrieval_ready`.
 *
 * Server-side and here, rather than on the click that started it: this is the
 * one place a request is committed exactly once, so the funnel counts restores
 * that actually exist rather than intents that may have thrown on the next
 * line. The browser used to fire this from two components, which is why it
 * doesn't any more (#426) — two emitters of one event name is a funnel that
 * silently double-counts.
 *
 * The worker's initiate-restore job was the other candidate and is wrong for
 * it: SQS delivers at least once and a redelivery re-plans rows that are still
 * `pending`, so the capture would fire again per retry.
 */
function captureRequested(
    request: NewRetrievalRequest,
    files: File[],
    newRestoreCount: number
): void {
    captureServerEvent(request.userId, PostHogEvent.RetrievalRequested, {
        requestId: request.id,
        tier: request.tier,
        fileCount: files.length,
        // The rest were already covered by a restore in flight. The gap between
        // these two is what a re-request of an in-progress set costs us, which
        // is nothing — worth being able to see.
        newRestoreCount,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        // Carried over from the click-time capture this replaced. A guess, as
        // the name says, but the only cold/warm signal available before the
        // worker's HEAD lands.
        probablyColdCount: files.filter(isProbablyCold).length,
        isZipDelivered: isDeliveredAsZip(files.length),
    });
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

/**
 * One downloadable restore, as the UI reads it.
 *
 * `expiresAt` is the artifacts' window, never the retrievals' (#426). A
 * zip-delivered request's thawed originals lapse after `ZIP_BUILD_RESTORE_DAYS`
 * while the zip they fed stays downloadable for
 * `RETRIEVAL_ARTIFACT_RETENTION_DAYS` — quoting the wrong one shows a working
 * download as expired for the last five of its seven days.
 */
export interface ReadyRetrievalRequest {
    requestId: string;
    tier: RestoreTier;
    fileCount: number;
    partCount: number;
    totalBytes: number;
    completedAt: Date;
    expiresAt: Date;
}

export interface ReadyRetrievalArtifact {
    artifactId: string;
    /** 1-based, for "Part 2 of 5" — `position` is 0-based on the row. */
    part: number;
    sizeBytes: number;
    fileName: string;
    expiresAt: Date;
}

/**
 * What the download panel found behind a `?request=` deep link.
 *
 * Three states rather than a nullable request, because the two non-ready ones
 * mean opposite things to the reader — one resolves itself, the other never
 * will — and because the panel polls on exactly that difference. The link
 * outlives the download it points at, so both are ordinary states to render,
 * not errors.
 */
export type RetrievalRequestDelivery =
    | { state: 'building' }
    | { state: 'expired' }
    | ({
          state: 'ready';
          artifacts: ReadyRetrievalArtifact[];
      } & ReadyRetrievalRequest);

function toReadyRequest(row: DownloadableRequest): ReadyRetrievalRequest {
    return {
        requestId: row.id,
        tier: row.tier,
        fileCount: row.fileCount,
        // `sum` comes back from postgres as a bigint string; the driver hands
        // it over as-is rather than as a number.
        totalBytes: Number(row.totalBytes),
        partCount: row.partCount,
        completedAt: row.completedAt,
        expiresAt: artifactWindowEnd(row.builtAt),
    };
}

/**
 * The user's restores that can be downloaded right now.
 *
 * Deliberately not derived from the retrieval rows the dashboard's "Retrieving"
 * card reads: those lapse two days after a zip request completes, which is when
 * this list is most useful.
 */
async function listReadyRequests(
    db: DB,
    userId: string
): Promise<ReadyRetrievalRequest[]> {
    const requestRepo = createRetrievalRequestRepo(db);
    const rows = await requestRepo.findDownloadableByUser(userId);
    return rows.map(toReadyRequest);
}

/**
 * One restore's delivery state, with its parts when there are any.
 *
 * A request belonging to someone else is a genuine 404 — the deep link is a URL
 * people forward, and a stranger's request must be indistinguishable from a
 * missing one.
 */
async function getRequestDelivery(
    db: DB,
    userId: string,
    requestId: string
): Promise<RetrievalRequestDelivery> {
    const requestRepo = createRetrievalRequestRepo(db);

    // Ownership first, and separately: findDownloadableByUser already scopes by
    // user, but it answers "downloadable" — it cannot tell a stranger's request
    // from one of this user's that hasn't finished, and those must not read the
    // same way.
    const request = await requestRepo.findByUserAndId(userId, requestId);
    if (!request) throw new NotFoundError('RetrievalRequest', requestId);

    const [row] = await requestRepo.findDownloadableByUser(userId, requestId);
    if (!row) {
        // `completed_at` is written only when every artifact is `ready`, so an
        // unset one is unambiguously still-building. Set but not downloadable
        // can only mean the lifecycle rule has taken the zips.
        return { state: request.completedAt ? 'expired' : 'building' };
    }

    const artifacts = await requestRepo.findArtifacts(requestId);
    return {
        state: 'ready',
        ...toReadyRequest(row),
        artifacts: artifacts
            // A `ready` artifact always has both a key and a completion time
            // behind it (the worker writes the object, then flips the status
            // and stamps the clock in one statement); testing for them anyway
            // is what makes the non-null assertions below honest rather than
            // hopeful — a null `completedAt` would throw inside the query.
            .filter(
                (artifact) =>
                    artifact.status === 'ready' &&
                    artifact.s3Key &&
                    artifact.completedAt
            )
            .map((artifact) => ({
                artifactId: artifact.id,
                part: artifact.position + 1,
                sizeBytes: artifact.sizeBytes ?? 0,
                fileName: artifactFileName(artifact.s3Key!, row.partCount),
                expiresAt: artifactWindowEnd(artifact.completedAt!),
            })),
    };
}

/** What a single-archive restore downloads as. */
const SINGLE_ARCHIVE_FILE_NAME = 'nexus-restore.zip';

/**
 * What the browser saves an artifact as.
 *
 * The S3 key ends in `nexus-part-N.zip` for every chunk, because the worker
 * names objects before anything has counted them. A one-chunk restore is not
 * "part 1" of anything, so it gets a plain name; a chunked one keeps the key's
 * tail so the parts sort and read as a set.
 */
function artifactFileName(s3Key: string, partCount: number): string {
    if (partCount === 1) return SINGLE_ARCHIVE_FILE_NAME;
    return s3Key.slice(s3Key.lastIndexOf('/') + 1);
}

/**
 * A short-lived GET for one zip artifact.
 *
 * No HEAD first, unlike `getDownloadUrl`: an artifact is an ordinary STANDARD
 * object we wrote ourselves, so there is no warm/cold question for S3 to
 * answer. What can still have happened is the lifecycle rule deleting it, which
 * the `ready`-and-in-window checks cover without a round trip — and a presigned
 * URL to a deleted key 404s at the browser, which is the same answer a HEAD
 * would have produced a second earlier.
 */
async function getArtifactDownloadUrl(
    db: DB,
    userId: string,
    artifactId: string
): Promise<DownloadUrlResult> {
    if (!s3.artifacts.isConfigured()) {
        throw new InvalidStateError(
            'Zip downloads are not available in this environment'
        );
    }

    const requestRepo = createRetrievalRequestRepo(db);
    const artifact = await requestRepo.findArtifactByUserAndId(
        userId,
        artifactId
    );
    if (!artifact) throw new NotFoundError('RetrievalArtifact', artifactId);

    if (
        artifact.status !== 'ready' ||
        !artifact.s3Key ||
        !artifact.completedAt
    ) {
        throw new InvalidStateError('This part is still being built');
    }
    if (artifactWindowEnd(artifact.completedAt) <= new Date()) {
        throw new InvalidStateError(
            'This download has expired; request the files again from your library'
        );
    }

    // Every artifact of the request, building ones included: the count is the
    // partition's, and it is fixed the moment the rows are minted.
    const parts = await requestRepo.findArtifacts(artifact.requestId);

    const url = await s3.artifacts.get(artifact.s3Key, {
        expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
        filename: artifactFileName(artifact.s3Key, parts.length),
    });

    return {
        url,
        expiresAt: new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000),
    };
}

export const retrievalService = {
    requestRetrieval,
    requestBulkRetrieval,
    requestBatchRetrieval,
    getRequestStatus,
    getDownloadUrl,
    listReadyRequests,
    getRequestDelivery,
    getArtifactDownloadUrl,
} as const;

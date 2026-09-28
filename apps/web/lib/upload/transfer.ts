import { createSemaphore, type Semaphore } from '@nexus/async';
import { retryAsync } from '@/lib/async/retry';
import type { xhrPut } from '@/lib/http/xhr';
import { captureEvent } from '@/lib/posthog/client';
import { PostHogEvent } from '@/lib/posthog/events';
import {
    isAbortError,
    isExpiredUrlError,
    isNetworkError,
    isQuotaExceededError,
    reportUploadFailure,
    uploadErrorMessage,
    uploadEventProps,
    type UploadEngine,
} from './errors';
import {
    MAX_CHUNK_RETRIES,
    MAX_CONCURRENT_CHUNKS,
    MULTIPART_THRESHOLD,
} from './limits';
import {
    computeRemainingPartNumbers,
    mergeParts,
    partByteRange,
    partsProgress,
} from './parts';
import type { FileRunOutcome } from './filePool';
import type { UploadRow } from './rows';
import type { CompletedPart, ResumableUpload } from './uploadStore';

/**
 * The two engines that move one file's bytes to S3 — a single presigned PUT,
 * or a resumable multipart upload — and the failure policy they share.
 *
 * Everything that leaves the tab arrives as a dependency, so the engines run
 * unchanged in the browser (tRPC mutations, XHR, IndexedDB) and in unit tests
 * (an in-memory backend, see ./testing).
 */

// AbortController reasons let the engine's catch tell why an in-flight upload
// was stopped: a pause keeps the persisted state for auto-resume, a cancel
// tears it down.
export const PAUSE = 'pause';
export const CANCEL = 'cancel';

interface UploadInit {
    name: string;
    sizeBytes: number;
    mimeType?: string;
    batchId?: string;
}

interface MultipartRef {
    fileId: string;
    uploadId: string;
}

/** The server procedures the engines call — `files.*` in the tRPC router. */
export interface TransferApi {
    upload(input: UploadInit): Promise<{ fileId: string; uploadUrl: string }>;
    confirmUpload(input: { fileId: string }): Promise<unknown>;
    /** Fire and forget: releases a single-part attempt being replaced. */
    abandonUpload(input: { fileId: string }): void;
    multipartInit(input: UploadInit): Promise<{
        fileId: string;
        uploadId: string;
        chunkSize: number;
        partUrls: string[];
    }>;
    multipartListParts(
        input: MultipartRef
    ): Promise<{ parts: { partNumber: number; etag: string }[] }>;
    multipartSignParts(
        input: MultipartRef & { partNumbers: number[] }
    ): Promise<{ parts: { partNumber: number; url: string }[] }>;
    multipartComplete(
        input: MultipartRef & { parts: CompletedPart[] }
    ): Promise<unknown>;
}

/** The persisted-resume record operations (./uploadStore). */
export interface TransferStore {
    putUpload(record: ResumableUpload): Promise<void>;
    addCompletedPart(fileId: string, part: CompletedPart): Promise<void>;
    deleteUpload(fileId: string): Promise<void>;
}

export interface TransferDeps {
    api: TransferApi;
    store: TransferStore;
    /** The browser→S3 PUT (`xhrPut`). */
    put: typeof xhrPut;
    /** One budget for the whole tab, shared across every engine and file. */
    s3Budget: Semaphore;
    updateRow: (id: string, updates: Partial<UploadRow>) => void;
    isOnline: () => boolean;
}

export interface Transfers {
    uploadSingleFile(row: UploadRow, batchId?: string): Promise<FileRunOutcome>;
    uploadMultipartFile(
        row: UploadRow,
        batchId?: string
    ): Promise<FileRunOutcome>;
    /** Routes a row to the engine its size calls for. */
    runUpload(row: UploadRow, batchId?: string): Promise<FileRunOutcome>;
}

/**
 * `upload_started` counts *attempts*, not uploads: both engines are also the
 * entry point for retry and auto-resume-on-reconnect, so one file that drops
 * and comes back emits several. Keeping the repeats (rather than suppressing
 * them) is deliberate — suppression needs a "already emitted" flag persisted
 * next to `completedParts`, and every way that flag can desync produces a
 * *missing* start, which silently undercounts the top of the funnel. Extra
 * events filter out at query time; absent ones don't come back.
 *
 * `clientUploadId` is what makes the attempts joinable, and it carries into
 * `upload_completed`/`upload_failed` for the same reason. `fileId` can't do
 * that job: the single engine mints a fresh one per attempt, so a retry looks
 * like a different upload. Session-scoped, not global — a re-added row after
 * reload gets a new one, which is the same boundary the join is useful across.
 */
function trackUploadStarted(
    engine: UploadEngine,
    row: UploadRow,
    batchId: string | undefined
): void {
    captureEvent(PostHogEvent.UploadStarted, {
        ...uploadEventProps(engine, { ...row, batchId }),
        // A row carrying either id has been through here before. Not the same
        // as "first attempt": an upload that dies before init assigns an id
        // re-enters as false, so dedupe on clientUploadId, not on this.
        isRetry: Boolean(row.uploadId ?? row.fileId),
        // ...and only a multipart upload with a live S3 uploadId resumes from
        // where it stopped. A single-engine retry restarts from byte zero, so
        // counting it as a resume would flatter any bytes-saved read.
        hasResumableState: Boolean(row.uploadId),
    });
}

function trackUploadCompleted(
    engine: UploadEngine,
    row: UploadRow,
    fileId: string | undefined,
    batchId: string | undefined
): void {
    captureEvent(
        PostHogEvent.UploadCompleted,
        uploadEventProps(engine, { ...row, fileId, batchId })
    );
}

export function createTransfers(deps: TransferDeps): Transfers {
    const { api, store, s3Budget, updateRow } = deps;

    /**
     * The failure policy both engines share, in one place so a fix can't land
     * in only one of them: an abort is a pause unless the row is being torn
     * down, a drop while offline waits for reconnect, and anything else is a
     * real failure the row reports and the user can retry. Quota is the one
     * failure about the account rather than the file, so it also stops the
     * pool from spending the rest of the queue on the same rejection.
     */
    const handleUploadFailure = (
        error: unknown,
        engine: UploadEngine,
        row: UploadRow,
        context: {
            // Fresher than the row's own: init assigns it after the engine
            // has already closed over `row`.
            fileId: string | undefined;
            batchId: string | undefined;
            signal: AbortSignal;
        }
    ): FileRunOutcome => {
        if (isAbortError(error)) {
            // A cancel tears the row down in dropRow, so there's nothing left
            // to update. A pause has to leave the row in `paused` for the
            // reconnect handler to find.
            if (context.signal.reason !== CANCEL) {
                updateRow(row.id, { status: 'paused' });
            }
            return 'continue';
        }
        if (isNetworkError(error) && !deps.isOnline()) {
            updateRow(row.id, { status: 'paused' });
            return 'continue';
        }
        reportUploadFailure(error, engine, {
            ...row,
            fileId: context.fileId,
            batchId: context.batchId,
        });
        updateRow(row.id, {
            status: 'error',
            error: uploadErrorMessage(error),
        });
        return isQuotaExceededError(error) ? 'halt' : 'continue';
    };

    // batchId is threaded explicitly (not read back from the rows) because a
    // just-issued row update isn't visible until the next render commit.
    // Callers without a session batch (retry) fall back to the row's own.
    const uploadSingleFile = async (
        row: UploadRow,
        batchId?: string
    ): Promise<FileRunOutcome> => {
        const file = row.file;
        if (!file) return 'continue';
        const sessionBatchId = batchId ?? row.batchId;
        const abortController = new AbortController();
        updateRow(row.id, { status: 'uploading', abortController });
        trackUploadStarted('single', row, sessionBatchId);

        // Carried outside the try so the failure report can include the id
        // once init has assigned it — the row snapshot predates init (mirrors
        // the multipart engine).
        let fileId = row.fileId;

        // Presign *inside* the permit, not before waiting for it: a
        // single-part URL lives 15 minutes, and a small file queued behind
        // multipart traffic on a slow uplink can wait longer than that.
        // Minting the URL after the wait means it is always fresh when the
        // PUT starts. The ~185ms this holds the permit is cheap, and it's
        // the only permit this worker takes, so it can't deadlock.
        const presignAndPut = () =>
            s3Budget.run(async () => {
                const init = await api.upload({
                    name: file.name,
                    sizeBytes: file.size,
                    mimeType: file.type || undefined,
                    batchId: sessionBatchId,
                });
                fileId = init.fileId;

                updateRow(row.id, { fileId });

                await deps.put(init.uploadUrl, file, {
                    onProgress: (loaded, total) => {
                        updateRow(row.id, {
                            progress: Math.round((loaded / total) * 100),
                        });
                    },
                    signal: abortController.signal,
                });
                return init.fileId;
            });

        try {
            // Every restart of this engine (retry, or auto-resume after a
            // network drop) mints a fresh fileId, row, and s3Key, so the
            // attempt being replaced has to be released here or it strands
            // as a hidden `uploading` row with billed bytes behind it (#330).
            // Multipart is the opposite — it resumes the same uploadId —
            // which is why this lives in the single engine.
            if (fileId) {
                api.abandonUpload({ fileId });
            }

            let confirmedFileId: string;
            try {
                confirmedFileId = await presignAndPut();
            } catch (error) {
                if (!isExpiredUrlError(error)) throw error;
                // S3 reports an expired URL as a 403. This engine has no
                // re-presign procedure — `files.upload` is the only source of
                // a single-part URL and it mints a whole new row — so
                // releasing the dead attempt and starting over is the
                // re-presign. Once: a 403 that isn't expiry (a bucket policy
                // denial) would fail identically forever.
                if (fileId) api.abandonUpload({ fileId });
                confirmedFileId = await presignAndPut();
            }

            // Confirm goes to the app origin, a different host with its own
            // socket budget, so it runs outside the S3 permit.
            await api.confirmUpload({ fileId: confirmedFileId });

            updateRow(row.id, { status: 'complete', progress: 100 });
            trackUploadCompleted('single', row, fileId, sessionBatchId);
            return 'continue';
        } catch (error) {
            return handleUploadFailure(error, 'single', row, {
                fileId,
                batchId: sessionBatchId,
                signal: abortController.signal,
            });
        }
    };

    // Same explicit batchId threading as uploadSingleFile; only the
    // fresh-start branch uses it (a resume already committed membership
    // server-side at the original init).
    const uploadMultipartFile = async (
        row: UploadRow,
        batchId?: string
    ): Promise<FileRunOutcome> => {
        const file = row.file;
        if (!file) return 'continue';
        const sessionBatchId = batchId ?? row.batchId;

        const abortController = new AbortController();
        updateRow(row.id, { status: 'uploading', abortController });
        trackUploadStarted('multipart', row, sessionBatchId);

        // Carried across the fresh-start / resume branches so the catch and
        // completion paths can act on whatever we managed to establish.
        let fileId = row.fileId;
        let uploadId = row.uploadId;
        let chunkSize = row.chunkSize ?? 0;
        let totalParts = row.totalParts ?? 0;
        let completed: CompletedPart[] = row.completedParts ?? [];

        try {
            // partNumber -> presigned URL for the parts we still need to send.
            const partUrls = new Map<number, string>();

            if (!uploadId) {
                // Fresh start: create the S3 multipart upload, presign every
                // part, and persist the record so an interruption is resumable.
                const result = await api.multipartInit({
                    name: file.name,
                    sizeBytes: file.size,
                    mimeType: file.type || undefined,
                    batchId: sessionBatchId,
                });
                fileId = result.fileId;
                uploadId = result.uploadId;
                chunkSize = result.chunkSize;
                totalParts = result.partUrls.length;
                completed = [];
                result.partUrls.forEach((url, i) => partUrls.set(i + 1, url));

                const now = Date.now();
                await store.putUpload({
                    fileId,
                    uploadId,
                    name: file.name,
                    size: file.size,
                    lastModified: file.lastModified,
                    mimeType: file.type || '',
                    chunkSize,
                    totalParts,
                    completedParts: [],
                    createdAt: now,
                    updatedAt: now,
                    // Persist the handle (when we have one) so an interruption
                    // is zero-touch resumable, not just re-add resumable.
                    fileHandle: row.fileHandle,
                    // Persist the batch so a post-reload resume rejoins it.
                    batchId: sessionBatchId,
                });
                updateRow(row.id, {
                    fileId,
                    uploadId,
                    chunkSize,
                    totalParts,
                    batchId: sessionBatchId,
                });
            } else {
                // Resume: reconcile against S3 (authoritative even if local
                // state is stale), then presign only the parts still missing.
                const listed = await api.multipartListParts({
                    fileId: fileId!,
                    uploadId,
                });
                completed = mergeParts(
                    completed,
                    listed.parts.map((p) => ({
                        partNumber: p.partNumber,
                        etag: p.etag,
                    }))
                );
                updateRow(row.id, { completedParts: completed });

                const remaining = computeRemainingPartNumbers(
                    totalParts,
                    completed
                );
                if (remaining.length > 0) {
                    const signed = await api.multipartSignParts({
                        fileId: fileId!,
                        uploadId,
                        partNumbers: remaining,
                    });
                    signed.parts.forEach((p) =>
                        partUrls.set(p.partNumber, p.url)
                    );
                }
            }

            let completedCount = completed.length;
            updateRow(row.id, {
                progress: partsProgress(completedCount, totalParts),
            });

            const uploadOnePart = async (partNumber: number): Promise<void> => {
                const { start, end } = partByteRange(
                    partNumber,
                    chunkSize,
                    file.size
                );
                const blob = file.slice(start, end);

                // Don't waste the retry budget on errors retrying can't fix:
                // an abort is final, and an expired URL needs re-presigning
                // first (handled below).
                const retryablePutError = (error: unknown) =>
                    !isAbortError(error) && !isExpiredUrlError(error);

                // One permit per attempt, taken and released around the PUT
                // itself: the retry backoff and the re-presign below happen
                // without holding a connection, and a chunk worker never
                // holds one permit while waiting on another.
                const put = (url: string) =>
                    retryAsync(
                        () =>
                            s3Budget.run(() =>
                                deps.put(url, blob, {
                                    signal: abortController.signal,
                                })
                            ),
                        MAX_CHUNK_RETRIES,
                        1000,
                        retryablePutError
                    );

                let url = partUrls.get(partNumber)!;
                let etag: string | null;
                try {
                    ({ etag } = await put(url));
                } catch (error) {
                    if (!isExpiredUrlError(error)) throw error;
                    // URL expired mid-upload (part URLs live 1h). Re-presign
                    // just this part and try once more — no restart.
                    const signed = await api.multipartSignParts({
                        fileId: fileId!,
                        uploadId: uploadId!,
                        partNumbers: [partNumber],
                    });
                    url = signed.parts[0].url;
                    ({ etag } = await put(url));
                }

                const part = { partNumber, etag: etag! };
                completed.push(part);
                await store.addCompletedPart(fileId!, part);

                completedCount++;
                updateRow(row.id, {
                    progress: partsProgress(completedCount, totalParts),
                });
            };

            // Per-file part concurrency. Deliberately fail-fast, unlike the
            // file pool: the first real failure aborts its siblings (their
            // in-flight PUTs reject) and propagates out, because these are
            // parts of one object rather than independent files.
            //
            // A part holds this file's chunk permit while waiting for the
            // shared S3 permit inside `put`. That nesting is always in the
            // same order — chunk budget, then connection budget — so it
            // can't deadlock, and the outer permit is what keeps
            // MAX_CONCURRENT_CHUNKS a per-file ceiling.
            const chunkBudget = createSemaphore(MAX_CONCURRENT_CHUNKS);
            const partNumbers = [...partUrls.keys()].sort((a, b) => a - b);
            let firstError: unknown = null;
            await Promise.all(
                partNumbers.map((partNumber) =>
                    chunkBudget.run(async () => {
                        if (firstError) return;
                        try {
                            await uploadOnePart(partNumber);
                        } catch (error) {
                            if (!firstError) {
                                firstError = error;
                                abortController.abort();
                            }
                        }
                    })
                )
            );
            if (firstError) throw firstError;

            await api.multipartComplete({
                fileId: fileId!,
                uploadId: uploadId!,
                parts: mergeParts(completed),
            });

            await store.deleteUpload(fileId!);
            updateRow(row.id, { status: 'complete', progress: 100 });
            trackUploadCompleted('multipart', row, fileId, sessionBatchId);
            return 'continue';
        } catch (error) {
            return handleUploadFailure(error, 'multipart', row, {
                fileId,
                batchId: sessionBatchId,
                signal: abortController.signal,
            });
        }
    };

    return {
        uploadSingleFile,
        uploadMultipartFile,
        runUpload: (row, batchId) =>
            row.size >= MULTIPART_THRESHOLD
                ? uploadMultipartFile(row, batchId)
                : uploadSingleFile(row, batchId),
    };
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { xhrPut } from '@/lib/http/xhr';
import { retryAsync } from '@/lib/async/retry';
import { createSemaphore } from '@/lib/async/semaphore';
import {
    createFilePool,
    type FilePool,
    type FileRunOutcome,
} from '@/lib/upload/filePool';
import {
    CONFIRM_RETRIES,
    MAX_CHUNK_RETRIES,
    MAX_CONCURRENT_CHUNKS,
    MAX_CONCURRENT_FILES,
    MAX_IN_FLIGHT_BYTES,
    MULTIPART_THRESHOLD,
    S3_CONNECTION_BUDGET,
} from '@/lib/upload/limits';
import {
    addCompletedPart,
    deleteUpload,
    findUploadByIdentity,
    listUploads,
    putUpload,
    type CompletedPart,
} from '@/lib/upload/uploadStore';
import {
    computeRemainingPartNumbers,
    isResumable,
    mergeParts,
    partByteRange,
    partsProgress,
    toFileIdentity,
} from '@/lib/upload/parts';
import {
    isFileSystemAccessSupported,
    reacquireMatchingFile,
    type PickedFile,
} from '@/lib/upload/fileSystemAccess';
import {
    isAbortError,
    isExpiredUrlError,
    isNetworkError,
    isQuotaExceededError,
    reportUploadFailure,
    uploadErrorMessage,
    uploadEventProps,
    type UploadEngine,
} from '@/lib/upload/errors';
import { captureEvent } from '@/lib/posthog/client';
import { PostHogEvent } from '@/lib/posthog/events';

// One budget for the whole tab, shared across every engine and file.
const s3Budget = createSemaphore(S3_CONNECTION_BUDGET);

// AbortController reasons let the engine's catch tell why an in-flight upload
// was stopped: a pause keeps the persisted state for auto-resume, a cancel
// tears it down.
const PAUSE = 'pause';
const CANCEL = 'cancel';

export type UploadStatus =
    | 'pending'
    // Admitted to the pool but not started — distinct from `pending` so the
    // Upload button only counts files the user hasn't submitted yet, which is
    // what lets files added mid-wave join the running wave with a click.
    | 'queued'
    | 'uploading'
    | 'paused'
    | 'resumable'
    | 'complete'
    | 'error';

export interface UploadFile {
    id: string;
    name: string;
    size: number;
    progress: number;
    status: UploadStatus;
    error?: string;
    // A `resumable` row whose persisted handle can be reopened in one click,
    // rather than requiring the user to re-add the file (Chromium only).
    isQuickResumable?: boolean;
    // Raw bytes when attached this session — drives the upload zone's local
    // blob previews. Null for rows restored after a reload until re-attached.
    previewFile?: File | null;
}

interface InternalUploadFile extends UploadFile {
    // Null for an interrupted upload detected on reload — the bytes are gone
    // until the user re-adds the file (or one-click reopens its handle), at
    // which point we reattach and resume.
    file: File | null;
    // Persisted File System Access handle; lets us silently reopen the bytes on
    // reload. Carried from the picker/drop and written into the IndexedDB record.
    fileHandle?: FileSystemFileHandle;
    // Identity field a reopened handle must match before we trust it to resume.
    lastModified?: number;
    fileId?: string;
    // Session batch the file belongs to — set once per Upload click and kept
    // across failures so a retry/resume rejoins the same batch.
    batchId?: string;
    uploadId?: string;
    chunkSize?: number;
    totalParts?: number;
    // Best-effort local cache of finished parts; S3 ListParts is the source of
    // truth reconciled on every resume.
    completedParts?: CompletedPart[];
    abortController?: AbortController;
}

/**
 * What the pool needs to admit a row: an identity to de-duplicate on, a size to
 * weigh against the in-flight byte budget, and the batch the row belongs to.
 * The row itself is re-read at start time, so nothing here can go stale.
 */
interface QueuedUpload {
    id: string;
    size: number;
    batchId?: string;
}

function toQueuedUpload(
    file: InternalUploadFile,
    batchId?: string
): QueuedUpload {
    return { id: file.id, size: file.size, batchId: batchId ?? file.batchId };
}

function randomId(): string {
    return Math.random().toString(36).substring(7);
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
    uploadFile: InternalUploadFile,
    batchId: string | undefined
): void {
    captureEvent(PostHogEvent.UploadStarted, {
        ...uploadEventProps(engine, { ...uploadFile, batchId }),
        // A row carrying either id has been through here before. Not the same
        // as "first attempt": an upload that dies before init assigns an id
        // re-enters as false, so dedupe on clientUploadId, not on this.
        isRetry: Boolean(uploadFile.uploadId ?? uploadFile.fileId),
        // ...and only a multipart upload with a live S3 uploadId resumes from
        // where it stopped. A single-engine retry restarts from byte zero, so
        // counting it as a resume would flatter any bytes-saved read.
        hasResumableState: Boolean(uploadFile.uploadId),
    });
}

function trackUploadCompleted(
    engine: UploadEngine,
    uploadFile: InternalUploadFile,
    fileId: string | undefined,
    batchId: string | undefined
): void {
    captureEvent(
        PostHogEvent.UploadCompleted,
        uploadEventProps(engine, { ...uploadFile, fileId, batchId })
    );
}

export function useUpload() {
    const trpc = useTRPC();
    const [files, setFiles] = useState<InternalUploadFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;

    const invalidateFileList = useInvalidateFileList();

    // These observers are shared by every file the pool runs at once. Each
    // `mutateAsync` call still builds its own mutation and resolves with its
    // own result, but the observer's `isPending`/`data`/`error` are
    // last-writer-wins across files — per-row state has to come from the row
    // itself, never from these objects.
    const uploadMutation = useMutation(trpc.files.upload.mutationOptions());
    const createBatchMutation = useMutation(
        trpc.files.createBatch.mutationOptions()
    );
    // Confirm/complete are retried in-mutation (default backoff matches
    // retryAsync's 1s/2s/4s) because the file data is already in S3. An
    // external retryAsync loop would fire the MutationCache Sentry capture
    // (lib/trpc/query-client.ts) once per attempt instead of once per failure.
    const confirmMutation = useMutation(
        trpc.files.confirmUpload.mutationOptions({ retry: CONFIRM_RETRIES })
    );
    const multipartInitMutation = useMutation(
        trpc.files.multipart.init.mutationOptions()
    );
    const multipartCompleteMutation = useMutation(
        trpc.files.multipart.complete.mutationOptions({
            retry: CONFIRM_RETRIES,
        })
    );
    // Both cleanup mutations fire and forget on a row the user already
    // dismissed, so a failure has nothing to tell them — the nightly
    // stale-`uploading` check is the backstop. Hence the shared skipToast.
    const multipartAbortMutation = useMutation(
        trpc.files.multipart.abort.mutationOptions({
            trpc: toastContext({ skipToast: true }),
        })
    );
    const abandonUploadMutation = useMutation(
        trpc.files.abandonUpload.mutationOptions({
            trpc: toastContext({ skipToast: true }),
        })
    );
    const multipartListPartsMutation = useMutation(
        trpc.files.multipart.listParts.mutationOptions()
    );
    const multipartSignPartsMutation = useMutation(
        trpc.files.multipart.signParts.mutationOptions()
    );

    const updateFile = useCallback(
        (id: string, updates: Partial<InternalUploadFile>) => {
            setFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
            );
        },
        []
    );

    /**
     * The failure policy both engines share, in one place so a fix can't land
     * in only one of them: an abort is a pause unless the row is being torn
     * down, a drop while offline waits for reconnect, and anything else is a
     * real failure the row reports and the user can retry. Quota is the one
     * failure about the account rather than the file, so it also stops the
     * pool from spending the rest of the queue on the same rejection.
     */
    const handleUploadFailure = useCallback(
        (
            error: unknown,
            engine: UploadEngine,
            uploadFile: InternalUploadFile,
            context: {
                // Fresher than the row's own: init assigns it after the engine
                // has already closed over `uploadFile`.
                fileId: string | undefined;
                batchId: string | undefined;
                signal: AbortSignal;
            }
        ): FileRunOutcome => {
            if (isAbortError(error)) {
                // A cancel tears the row down in cancelFile, so there's nothing
                // left to update. A pause has to leave the row in `paused` for
                // the reconnect handler to find.
                if (context.signal.reason !== CANCEL) {
                    updateFile(uploadFile.id, { status: 'paused' });
                }
                return 'continue';
            }
            if (isNetworkError(error) && !navigatorIsOnline()) {
                updateFile(uploadFile.id, { status: 'paused' });
                return 'continue';
            }
            reportUploadFailure(error, engine, {
                ...uploadFile,
                fileId: context.fileId,
                batchId: context.batchId,
            });
            updateFile(uploadFile.id, {
                status: 'error',
                error: uploadErrorMessage(error),
            });
            return isQuotaExceededError(error) ? 'halt' : 'continue';
        },
        [updateFile]
    );

    const uploadSingleFile = useCallback(
        // batchId is threaded explicitly (not read back via filesRef) because a
        // just-issued updateFile isn't visible until the next render commit.
        // Callers without a session batch (retry) fall back to the row's own.
        async (
            uploadFile: InternalUploadFile,
            batchId?: string
        ): Promise<FileRunOutcome> => {
            const file = uploadFile.file;
            if (!file) return 'continue';
            const sessionBatchId = batchId ?? uploadFile.batchId;
            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });
            trackUploadStarted('single', uploadFile, sessionBatchId);

            // Carried outside the try so the failure report can include the
            // id once init has assigned it — the uploadFile closure predates
            // init (mirrors the multipart engine).
            let fileId = uploadFile.fileId;

            // Presign *inside* the permit, not before waiting for it: a
            // single-part URL lives 15 minutes, and a small file queued behind
            // multipart traffic on a slow uplink can wait longer than that.
            // Minting the URL after the wait means it is always fresh when the
            // PUT starts. The ~185ms this holds the permit is cheap, and it's
            // the only permit this worker takes, so it can't deadlock.
            const presignAndPut = () =>
                s3Budget.run(async () => {
                    const init = await uploadMutation.mutateAsync({
                        name: file.name,
                        sizeBytes: file.size,
                        mimeType: file.type || undefined,
                        batchId: sessionBatchId,
                    });
                    fileId = init.fileId;

                    updateFile(uploadFile.id, { fileId });

                    await xhrPut(init.uploadUrl, file, {
                        onProgress: (loaded, total) => {
                            updateFile(uploadFile.id, {
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
                // as a hidden `uploading` row with billed bytes behind it
                // (#330). Multipart is the opposite — it resumes the same
                // uploadId — which is why this lives in the single engine.
                if (fileId) {
                    abandonUploadMutation.mutate({ fileId });
                }

                let confirmedFileId: string;
                try {
                    confirmedFileId = await presignAndPut();
                } catch (error) {
                    if (!isExpiredUrlError(error)) throw error;
                    // S3 reports an expired URL as a 403. This engine has no
                    // re-presign procedure — `files.upload` is the only source
                    // of a single-part URL and it mints a whole new row — so
                    // releasing the dead attempt and starting over is the
                    // re-presign. Once: a 403 that isn't expiry (a bucket
                    // policy denial) would fail identically forever.
                    if (fileId) abandonUploadMutation.mutate({ fileId });
                    confirmedFileId = await presignAndPut();
                }

                // Confirm goes to the app origin, a different host with its own
                // socket budget, so it runs outside the S3 permit.
                await confirmMutation.mutateAsync({ fileId: confirmedFileId });

                updateFile(uploadFile.id, {
                    status: 'complete',
                    progress: 100,
                });
                trackUploadCompleted(
                    'single',
                    uploadFile,
                    fileId,
                    sessionBatchId
                );
                return 'continue';
            } catch (error) {
                return handleUploadFailure(error, 'single', uploadFile, {
                    fileId,
                    batchId: sessionBatchId,
                    signal: abortController.signal,
                });
            }
        },
        [
            uploadMutation,
            confirmMutation,
            abandonUploadMutation,
            updateFile,
            handleUploadFailure,
        ]
    );

    const uploadMultipartFile = useCallback(
        // Same explicit batchId threading as uploadSingleFile; only the
        // fresh-start branch uses it (a resume already committed membership
        // server-side at the original init).
        async (
            uploadFile: InternalUploadFile,
            batchId?: string
        ): Promise<FileRunOutcome> => {
            const file = uploadFile.file;
            if (!file) return 'continue';
            const sessionBatchId = batchId ?? uploadFile.batchId;

            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });
            trackUploadStarted('multipart', uploadFile, sessionBatchId);

            // Carried across the fresh-start / resume branches so the catch and
            // completion paths can act on whatever we managed to establish.
            let fileId = uploadFile.fileId;
            let uploadId = uploadFile.uploadId;
            let chunkSize = uploadFile.chunkSize ?? 0;
            let totalParts = uploadFile.totalParts ?? 0;
            let completed: CompletedPart[] = uploadFile.completedParts ?? [];

            try {
                // partNumber -> presigned URL for the parts we still need to send.
                const partUrls = new Map<number, string>();

                if (!uploadId) {
                    // Fresh start: create the S3 multipart upload, presign every
                    // part, and persist the record so an interruption is resumable.
                    const result = await multipartInitMutation.mutateAsync({
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
                    result.partUrls.forEach((url, i) =>
                        partUrls.set(i + 1, url)
                    );

                    const now = Date.now();
                    await putUpload({
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
                        fileHandle: uploadFile.fileHandle,
                        // Persist the batch so a post-reload resume rejoins it.
                        batchId: sessionBatchId,
                    });
                    updateFile(uploadFile.id, {
                        fileId,
                        uploadId,
                        chunkSize,
                        totalParts,
                        batchId: sessionBatchId,
                    });
                } else {
                    // Resume: reconcile against S3 (authoritative even if local
                    // state is stale), then presign only the parts still missing.
                    const listed = await multipartListPartsMutation.mutateAsync(
                        {
                            fileId: fileId!,
                            uploadId,
                        }
                    );
                    completed = mergeParts(
                        completed,
                        listed.parts.map((p) => ({
                            partNumber: p.partNumber,
                            etag: p.etag,
                        }))
                    );
                    updateFile(uploadFile.id, { completedParts: completed });

                    const remaining = computeRemainingPartNumbers(
                        totalParts,
                        completed
                    );
                    if (remaining.length > 0) {
                        const signed =
                            await multipartSignPartsMutation.mutateAsync({
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
                updateFile(uploadFile.id, {
                    progress: partsProgress(completedCount, totalParts),
                });

                const uploadOnePart = async (
                    partNumber: number
                ): Promise<void> => {
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
                                    xhrPut(url, blob, {
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
                        const signed =
                            await multipartSignPartsMutation.mutateAsync({
                                fileId: fileId!,
                                uploadId: uploadId!,
                                partNumbers: [partNumber],
                            });
                        url = signed.parts[0].url;
                        ({ etag } = await put(url));
                    }

                    const part = { partNumber, etag: etag! };
                    completed.push(part);
                    await addCompletedPart(fileId!, part);

                    completedCount++;
                    updateFile(uploadFile.id, {
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

                await multipartCompleteMutation.mutateAsync({
                    fileId: fileId!,
                    uploadId: uploadId!,
                    parts: mergeParts(completed),
                });

                await deleteUpload(fileId!);
                updateFile(uploadFile.id, {
                    status: 'complete',
                    progress: 100,
                });
                trackUploadCompleted(
                    'multipart',
                    uploadFile,
                    fileId,
                    sessionBatchId
                );
                return 'continue';
            } catch (error) {
                return handleUploadFailure(error, 'multipart', uploadFile, {
                    fileId,
                    batchId: sessionBatchId,
                    signal: abortController.signal,
                });
            }
        },
        [
            multipartInitMutation,
            multipartCompleteMutation,
            multipartListPartsMutation,
            multipartSignPartsMutation,
            updateFile,
            handleUploadFailure,
        ]
    );

    const runUpload = useCallback(
        (uploadFile: InternalUploadFile, batchId?: string) =>
            uploadFile.size >= MULTIPART_THRESHOLD
                ? uploadMultipartFile(uploadFile, batchId)
                : uploadSingleFile(uploadFile, batchId),
        [uploadMultipartFile, uploadSingleFile]
    );

    // The pool re-reads the row here rather than trusting the queued snapshot:
    // between admission and start the user may have removed the row, and a
    // prior attempt may have left a fileId/uploadId worth resuming from. Only
    // the row's existence is checked, not its status — `filesRef` is assigned
    // during render, so a just-issued "pending" hasn't committed yet.
    const runQueued = useCallback(
        async (item: QueuedUpload): Promise<FileRunOutcome> => {
            const current = filesRef.current.find((f) => f.id === item.id);
            if (!current?.file) return 'continue';
            // A drop mid-wave pauses the files already in flight, but the pool
            // keeps handing out the rest of the queue. Park them in `paused`
            // alongside their siblings — the reconnect handler resumes the
            // whole set — rather than spending a doomed presign on each and
            // leaving a row in `error` that nothing comes back for.
            if (!navigatorIsOnline()) {
                updateFile(current.id, { status: 'paused' });
                return 'continue';
            }
            return runUpload(current, item.batchId);
        },
        [runUpload, updateFile]
    );

    // Callbacks reach the pool through refs so it can be built once and outlive
    // their re-creation — a pool rebuilt mid-wave would lose its in-flight set.
    const runQueuedRef = useRef(runQueued);
    runQueuedRef.current = runQueued;
    const invalidateFileListRef = useRef(invalidateFileList);
    invalidateFileListRef.current = invalidateFileList;

    const poolRef = useRef<FilePool<QueuedUpload> | null>(null);
    poolRef.current ??= createFilePool<QueuedUpload>({
        maxConcurrent: MAX_CONCURRENT_FILES,
        maxInFlightBytes: MAX_IN_FLIGHT_BYTES,
        run: (item) => runQueuedRef.current(item),
        // Once per drained wave, not once per file: four concurrent files
        // would otherwise fire four refetch storms across three queries.
        onDrained: () => invalidateFileListRef.current(),
        // A quota halt throws away the queue; put those rows back to
        // `pending` so the Upload button re-owns them instead of leaving
        // them stranded in `queued` with nothing left to start them.
        // (`updateFile` is stable, so closing over it here is safe.)
        onDropped: (items) => {
            for (const item of items) {
                updateFile(item.id, { status: 'pending' });
            }
        },
    });

    // `isUploading` has several owners (the pool, quick-resume) and must not
    // dip between files — the Upload button reads it, so a momentary false
    // re-enables and re-labels it mid-wave.
    const activeDriversRef = useRef(0);
    const withUploadingState = useCallback(
        async (work: () => Promise<void>): Promise<void> => {
            activeDriversRef.current++;
            setIsUploading(true);
            try {
                await work();
            } finally {
                activeDriversRef.current--;
                if (activeDriversRef.current === 0) setIsUploading(false);
            }
        },
        []
    );

    const drive = useCallback(
        (items: QueuedUpload[]) =>
            withUploadingState(() => poolRef.current!.enqueue(items)),
        [withUploadingState]
    );

    const processQueue = useCallback(async () => {
        const pending = filesRef.current.filter(
            (f) => f.status === 'pending' && f.file
        );
        if (pending.length === 0) return;

        // Claim the rows before the batch round trip: the Upload button stays
        // enabled while a wave runs (so added files can join it), which makes
        // a second click during the await possible — `queued` is what keeps
        // that click from minting a second batch for the same rows.
        for (const f of pending) {
            updateFile(f.id, { status: 'queued' });
        }

        // One batch per Upload click: every pending file in this pass joins
        // it, so a multi-file selection lands in a single upload_batches row.
        // Created fresh per invocation — files queued later get a new batch on
        // the next click. On failure we proceed without an id and each file
        // falls back to the server's auto-created single-file batch.
        let batchId: string | undefined;
        // Rows that already have a batch (retries, re-added resumables) keep
        // it, so only mint a session batch when some file still needs one.
        if (pending.some((f) => !f.batchId)) {
            try {
                ({ batchId } = await createBatchMutation.mutateAsync());
            } catch {
                batchId = undefined;
            }
        }

        // Retried/resumed rows keep their original batch; only rows without one
        // join this session's batch. Written to the row for retry/persistence,
        // but carried on the queue item too — the ref won't reflect this update
        // until the next render commit.
        const queued = pending.map((f) => {
            const rowBatchId = f.batchId ?? batchId;
            updateFile(f.id, { batchId: rowBatchId });
            return toQueuedUpload(f, rowBatchId);
        });

        await drive(queued);
    }, [drive, createBatchMutation, updateFile]);

    // Surface interrupted uploads found in IndexedDB on mount as `resumable`
    // rows. Records that persisted a File System Access handle (and run on a
    // browser that supports it) are marked `isQuickResumable` — the bytes can be
    // reopened in one click. The rest show until the user re-adds the file.
    // Runs once per mount; the setFiles dedupe (by fileId) keeps it idempotent
    // under React StrictMode's double-invoked effects, so no cancel flag needed.
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
        const hasFileSystemAccess = isFileSystemAccessSupported();
        void (async () => {
            const records = await listUploads();
            const resumable = records.filter(isResumable);
            if (resumable.length === 0) return;
            setFiles((prev) => {
                const existing = new Set(prev.map((f) => f.fileId));
                const rows: InternalUploadFile[] = resumable
                    .filter((r) => !existing.has(r.fileId))
                    .map((r) => ({
                        id: r.fileId,
                        name: r.name,
                        size: r.size,
                        progress: partsProgress(
                            r.completedParts.length,
                            r.totalParts
                        ),
                        status: 'resumable' as const,
                        isQuickResumable: hasFileSystemAccess && !!r.fileHandle,
                        file: null,
                        fileHandle: r.fileHandle,
                        lastModified: r.lastModified,
                        fileId: r.fileId,
                        batchId: r.batchId,
                        uploadId: r.uploadId,
                        chunkSize: r.chunkSize,
                        totalParts: r.totalParts,
                        completedParts: r.completedParts,
                    }));
                return rows.length > 0 ? [...prev, ...rows] : prev;
            });
        })();
    }, []);

    // Pause the active upload(s) when the browser goes offline; auto-resume the
    // paused ones when it comes back. Same-session resume reuses the in-memory
    // File, so it needs no user action.
    useEffect(() => {
        const onOffline = () => {
            let pausedAny = false;
            for (const f of filesRef.current) {
                if (f.status === 'uploading' && f.abortController) {
                    f.abortController.abort(PAUSE);
                    pausedAny = true;
                }
            }
            if (pausedAny) {
                toast.info('Upload paused — waiting for your connection');
            }
        };
        const onOnline = () => {
            const paused = filesRef.current.filter(
                (f) => f.status === 'paused' && f.file
            );
            if (paused.length === 0) return;
            toast.info('Back online — resuming upload');
            // Back through the same pool, so a reconnect with twenty paused
            // rows resumes them four at a time rather than all at once. Each
            // row re-enters its own engine: a single-part upload paused by a
            // drop restarts from byte zero, multipart resumes its parts.
            void drive(paused.map((f) => toQueuedUpload(f)));
        };
        window.addEventListener('offline', onOffline);
        window.addEventListener('online', onOnline);
        return () => {
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('online', onOnline);
        };
    }, [drive]);

    const addFiles = useCallback(async (picked: PickedFile[]) => {
        if (picked.length === 0) return;

        // Match each file against a persisted interrupted upload so a re-add
        // resumes from where S3 left off instead of starting over.
        const matches = await Promise.all(
            picked.map(({ file }) => findUploadByIdentity(toFileIdentity(file)))
        );

        setFiles((prev) => {
            // Reattach re-added files to their resumable rows (immutably), then
            // append rows for everything that didn't match an existing row.
            const reattach = new Map<string, PickedFile>();
            const appended: InternalUploadFile[] = [];

            picked.forEach(({ file, handle }, i) => {
                const match = matches[i];
                const existing =
                    match && isResumable(match)
                        ? prev.find((f) => f.fileId === match.fileId)
                        : undefined;

                if (match && isResumable(match) && existing) {
                    // Re-add of an interrupted upload: queue it as resumable;
                    // clicking Upload continues from the last completed part.
                    reattach.set(existing.id, { file, handle });
                    return;
                }
                if (match && isResumable(match)) {
                    appended.push({
                        id: match.fileId,
                        name: file.name,
                        size: file.size,
                        progress: partsProgress(
                            match.completedParts.length,
                            match.totalParts
                        ),
                        status: 'pending',
                        file,
                        fileHandle: handle,
                        fileId: match.fileId,
                        batchId: match.batchId,
                        uploadId: match.uploadId,
                        chunkSize: match.chunkSize,
                        totalParts: match.totalParts,
                        completedParts: match.completedParts,
                    });
                    return;
                }
                appended.push({
                    id: randomId(),
                    name: file.name,
                    size: file.size,
                    progress: 0,
                    status: 'pending',
                    file,
                    fileHandle: handle,
                });
            });

            const updated = prev.map((f) => {
                const reattached = reattach.get(f.id);
                return reattached
                    ? {
                          ...f,
                          file: reattached.file,
                          // Keep any handle we already had if the re-add lacked one.
                          fileHandle: reattached.handle ?? f.fileHandle,
                          status: 'pending' as const,
                          progress: partsProgress(
                              f.completedParts?.length ?? 0,
                              f.totalParts ?? 0
                          ),
                      }
                    : f;
            });
            return [...updated, ...appended];
        });
    }, []);

    // Release whatever the server already minted for a row we're dropping: the
    // S3 multipart session when there is one (plus its persisted state, so a
    // cancelled upload doesn't linger as resumable), otherwise the plain object
    // at the row's recorded key. A row that never reached the server has no
    // fileId and nothing to release. Fire-and-forget — the row leaves the UI
    // either way, and the nightly stale-upload check backs this up.
    const abandonServerUpload = useCallback(
        (file: InternalUploadFile | undefined) => {
            // Skipping `complete` rows is an optimization, not the safety net:
            // clear-all sweeps confirmed rows too, and there's no point asking
            // the server to release an upload the UI already knows finished.
            // Refusing to touch a confirmed file is the server's job, and
            // `releaseUpload` does it for both engines.
            if (!file?.fileId || file.status === 'complete') return;
            if (file.uploadId) {
                multipartAbortMutation.mutate({
                    fileId: file.fileId,
                    uploadId: file.uploadId,
                });
                void deleteUpload(file.fileId);
                return;
            }
            abandonUploadMutation.mutate({ fileId: file.fileId });
        },
        [multipartAbortMutation, abandonUploadMutation]
    );

    // Drop a row and release anything the server holds for it. Exposed under
    // two names because the UI offers two affordances — Remove on a queued row,
    // Cancel on one in flight — but there's a single operation behind them.
    const dropRow = useCallback(
        (id: string) => {
            const file = filesRef.current.find((f) => f.id === id);
            file?.abortController?.abort(CANCEL);
            abandonServerUpload(file);
            setFiles((prev) => prev.filter((f) => f.id !== id));
        },
        [abandonServerUpload]
    );
    const removeFile = dropRow;
    const cancelFile = dropRow;

    // Clear all empties the list; it is not a per-row "give up on this upload"
    // the way Cancel/Remove is. So it must not destroy multipart work the user
    // can still come back to: a row carrying an `uploadId` has parts in S3 and
    // a persisted record behind it, and releasing it here would abort the
    // session and delete that record, silently killing an upload the queue is
    // offering to resume. Those are left to the bucket's 7-day
    // abort-incomplete-multipart rule and the nightly stale-upload check.
    // Single-part rows mint no session and have nothing to resume, so they
    // still get released — that is the #330 leak this whole path exists for.
    const clearFiles = useCallback(() => {
        for (const file of filesRef.current) {
            file.abortController?.abort(CANCEL);
            if (file.uploadId) continue;
            abandonServerUpload(file);
        }
        setFiles([]);
    }, [abandonServerUpload]);

    // Retry joins the live pool rather than waiting for it to empty: with
    // several files in flight, a failed row's Retry is most often clicked while
    // its siblings are still going.
    const retryFile = useCallback(
        (id: string) => {
            const file = filesRef.current.find((f) => f.id === id);
            if (!file?.file) return;
            // Straight to `queued`, not `pending`: the row is being handed to
            // the pool right now, so it must not re-enter the Upload button's
            // pending count on the way through.
            updateFile(id, {
                status: 'queued',
                error: undefined,
            });
            void drive([toQueuedUpload(file)]);
        },
        [updateFile, drive]
    );

    // Reopen interrupted uploads from their persisted handles and resume them
    // through the same multipart engine. Handles are reopened up front (in
    // parallel) so the permission prompts ride the single click that triggered
    // this, then resumed serially like the normal queue. A row whose handle
    // can't be reopened (permission denied, file moved/changed) loses its
    // quick-resume affordance and falls back to the manual re-add flow.
    const resumeRows = useCallback(
        async (rows: InternalUploadFile[]) => {
            if (rows.length === 0) return;
            await withUploadingState(async () => {
                const reopened = await Promise.all(
                    rows.map(async (row) => ({
                        row,
                        file: await reacquireRowFile(row),
                    }))
                );
                let hasResumedAny = false;
                for (const { row, file } of reopened) {
                    if (!file) {
                        updateFile(row.id, { isQuickResumable: false });
                        continue;
                    }
                    hasResumedAny = true;
                    // `queued`, not `pending`: the row is on its way into the
                    // engine, so it must not count toward the Upload button.
                    updateFile(row.id, {
                        file,
                        status: 'queued',
                        error: undefined,
                    });
                    await uploadMultipartFile({
                        ...row,
                        file,
                        status: 'queued',
                    });
                }
                if (!hasResumedAny) {
                    toast.error(
                        rows.length > 1
                            ? "Couldn't reopen the files — re-add them to resume"
                            : "Couldn't reopen the file — re-add it to resume"
                    );
                    return;
                }
                // The engines no longer refresh the list per file — the pool
                // does it once per wave, and this path bypasses the pool.
                await invalidateFileList();
            });
        },
        [
            updateFile,
            uploadMultipartFile,
            withUploadingState,
            invalidateFileList,
        ]
    );

    const resumeWithHandle = useCallback(
        (id: string) => {
            const row = filesRef.current.find((f) => f.id === id);
            if (row) void resumeRows([row]);
        },
        [resumeRows]
    );

    const resumeAllWithHandles = useCallback(() => {
        const rows = filesRef.current.filter(
            (f) => f.status === 'resumable' && f.isQuickResumable
        );
        void resumeRows(rows);
    }, [resumeRows]);

    // Expose only the public UploadFile shape (strip internal fields)
    const publicFiles: UploadFile[] = files.map(
        ({
            id,
            name,
            size,
            progress,
            status,
            error,
            isQuickResumable,
            file,
        }) => ({
            id,
            name,
            size,
            progress,
            status,
            error,
            isQuickResumable,
            previewFile: file,
        })
    );

    return {
        files: publicFiles,
        isUploading,
        addFiles,
        removeFile,
        clearFiles,
        startUpload: processQueue,
        cancelFile,
        retryFile,
        resumeWithHandle,
        resumeAllWithHandles,
    };
}

// Reopen the bytes behind a resumable row's persisted handle, verifying identity.
// Resolves to null (so the caller falls back to re-add) when there's no handle or
// it can't be reopened. Lives at module scope since it touches no reactive state.
function reacquireRowFile(row: InternalUploadFile): Promise<File | null> {
    if (!row.fileHandle) return Promise.resolve(null);
    return reacquireMatchingFile(row.fileHandle, {
        name: row.name,
        size: row.size,
        lastModified: row.lastModified ?? 0,
    });
}

// Wrapped so it's easy to reason about in non-browser test contexts; the engine
// only calls it after a network error to decide pause-vs-fail.
function navigatorIsOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
}

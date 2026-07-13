'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTRPC } from '@/lib/trpc/client';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { xhrPut } from '@/lib/http/xhr';
import { retryAsync } from '@/lib/async/retry';
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
    reportUploadFailure,
} from '@/lib/upload/errors';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const MAX_CONCURRENT_CHUNKS = 3;
const MAX_CHUNK_RETRIES = 3;
const CONFIRM_RETRIES = 3;

// AbortController reasons let the engine's catch tell why an in-flight upload
// was stopped: a pause keeps the persisted state for auto-resume, a cancel
// tears it down.
const PAUSE = 'pause';
const CANCEL = 'cancel';

export type UploadStatus =
    | 'pending'
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

function randomId(): string {
    return Math.random().toString(36).substring(7);
}

export function useUpload() {
    const trpc = useTRPC();
    const [files, setFiles] = useState<InternalUploadFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;

    const invalidateFileList = useInvalidateFileList();

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
    const multipartAbortMutation = useMutation(
        trpc.files.multipart.abort.mutationOptions()
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

    const uploadSingleFile = useCallback(
        // batchId is threaded explicitly (not read back via filesRef) because a
        // just-issued updateFile isn't visible until the next render commit.
        // Callers without a session batch (retry) fall back to the row's own.
        async (uploadFile: InternalUploadFile, batchId?: string) => {
            const file = uploadFile.file;
            if (!file) return;
            const sessionBatchId = batchId ?? uploadFile.batchId;
            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });

            // Carried outside the try so the failure report can include the
            // id once init has assigned it — the uploadFile closure predates
            // init (mirrors the multipart engine).
            let fileId = uploadFile.fileId;
            try {
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

                await confirmMutation.mutateAsync({ fileId: init.fileId });

                updateFile(uploadFile.id, {
                    status: 'complete',
                    progress: 100,
                });
                await invalidateFileList();
            } catch (error) {
                if (isAbortError(error)) {
                    return;
                }
                // A network drop pauses for reconnect rather than failing the
                // upload — same policy as the multipart engine; the online
                // handler restarts it.
                if (isNetworkError(error) && !navigatorIsOnline()) {
                    updateFile(uploadFile.id, { status: 'paused' });
                    return;
                }
                reportUploadFailure(error, 'single', {
                    ...uploadFile,
                    fileId,
                    batchId: sessionBatchId,
                });
                updateFile(uploadFile.id, {
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Upload failed',
                });
            }
        },
        [uploadMutation, confirmMutation, updateFile, invalidateFileList]
    );

    const uploadMultipartFile = useCallback(
        // Same explicit batchId threading as uploadSingleFile; only the
        // fresh-start branch uses it (a resume already committed membership
        // server-side at the original init).
        async (uploadFile: InternalUploadFile, batchId?: string) => {
            const file = uploadFile.file;
            if (!file) return;
            const sessionBatchId = batchId ?? uploadFile.batchId;

            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });

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

                    const put = (url: string) =>
                        retryAsync(
                            () =>
                                xhrPut(url, blob, {
                                    signal: abortController.signal,
                                }),
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

                // Bounded worker pool. The first real failure aborts its
                // siblings (their in-flight PUTs reject) and propagates out.
                const queue = [...partUrls.keys()].sort((a, b) => a - b);
                let firstError: unknown = null;
                const worker = async (): Promise<void> => {
                    while (queue.length > 0 && !firstError) {
                        const partNumber = queue.shift()!;
                        try {
                            await uploadOnePart(partNumber);
                        } catch (error) {
                            if (!firstError) {
                                firstError = error;
                                abortController.abort();
                            }
                            return;
                        }
                    }
                };
                await Promise.all(
                    Array.from(
                        {
                            length: Math.min(
                                MAX_CONCURRENT_CHUNKS,
                                queue.length
                            ),
                        },
                        () => worker()
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
                await invalidateFileList();
            } catch (error) {
                if (isAbortError(error)) {
                    // A cancel tears everything down in cancelFile; the engine
                    // just stands down. A pause keeps the record for resume.
                    if (abortController.signal.reason === CANCEL) return;
                    updateFile(uploadFile.id, { status: 'paused' });
                    return;
                }
                // A network drop past the retry budget pauses for reconnect
                // rather than failing the whole upload.
                if (isNetworkError(error) && !navigatorIsOnline()) {
                    updateFile(uploadFile.id, { status: 'paused' });
                    return;
                }
                // Spread picks up the local fileId assigned after init and
                // the threaded session batch — both fresher than the stale
                // uploadFile closure.
                reportUploadFailure(error, 'multipart', {
                    ...uploadFile,
                    fileId,
                    batchId: sessionBatchId,
                });
                updateFile(uploadFile.id, {
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Upload failed',
                });
            }
        },
        [
            multipartInitMutation,
            multipartCompleteMutation,
            multipartListPartsMutation,
            multipartSignPartsMutation,
            updateFile,
            invalidateFileList,
        ]
    );

    const runUpload = useCallback(
        (uploadFile: InternalUploadFile, batchId?: string) =>
            uploadFile.size >= MULTIPART_THRESHOLD
                ? uploadMultipartFile(uploadFile, batchId)
                : uploadSingleFile(uploadFile, batchId),
        [uploadMultipartFile, uploadSingleFile]
    );

    const processQueue = useCallback(async () => {
        setIsUploading(true);

        // One batch per Upload click: every pending file in this pass joins
        // it, so a multi-file selection lands in a single upload_batches row.
        // Created fresh per invocation — files queued later get a new batch on
        // the next click. On failure we proceed without an id and each file
        // falls back to the server's auto-created single-file batch.
        let batchId: string | undefined;
        // Rows that already have a batch (retries, re-added resumables) keep
        // it, so only mint a session batch when some file still needs one.
        const hasPending = filesRef.current.some(
            (f) => f.status === 'pending' && f.file && !f.batchId
        );
        if (hasPending) {
            try {
                ({ batchId } = await createBatchMutation.mutateAsync());
            } catch {
                batchId = undefined;
            }
        }

        for (const file of filesRef.current) {
            if (file.status !== 'pending') continue;

            // Re-read from ref to get latest state (file may have been removed)
            const current = filesRef.current.find((f) => f.id === file.id);
            if (!current || current.status !== 'pending' || !current.file) {
                continue;
            }

            // Retried/resumed rows keep their original batch; only rows
            // without one join this session's batch. Written to the row for
            // retry/persistence, but threaded to runUpload explicitly — the
            // ref won't reflect this update until the next render commit.
            const rowBatchId = current.batchId ?? batchId;
            updateFile(current.id, { batchId: rowBatchId });
            await runUpload(current, rowBatchId);
        }

        setIsUploading(false);
    }, [runUpload, createBatchMutation, updateFile]);

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
            void (async () => {
                setIsUploading(true);
                for (const f of paused) {
                    const current = filesRef.current.find((x) => x.id === f.id);
                    if (current?.status === 'paused' && current.file) {
                        // runUpload, not uploadMultipartFile: a single-engine
                        // upload paused by a network drop restarts through
                        // its own engine.
                        await runUpload(current);
                    }
                }
                setIsUploading(false);
            })();
        };
        window.addEventListener('offline', onOffline);
        window.addEventListener('online', onOnline);
        return () => {
            window.removeEventListener('offline', onOffline);
            window.removeEventListener('online', onOnline);
        };
    }, [runUpload]);

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

    const removeFile = useCallback((id: string) => {
        const file = filesRef.current.find((f) => f.id === id);
        file?.abortController?.abort(CANCEL);
        setFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const clearFiles = useCallback(() => {
        for (const file of filesRef.current) {
            file.abortController?.abort(CANCEL);
        }
        setFiles([]);
    }, []);

    const cancelFile = useCallback(
        (id: string) => {
            const file = filesRef.current.find((f) => f.id === id);
            file?.abortController?.abort(CANCEL);
            // Abort the S3 multipart session and drop the persisted state so a
            // cancelled upload doesn't linger as resumable.
            if (file?.fileId && file?.uploadId) {
                multipartAbortMutation.mutate({
                    fileId: file.fileId,
                    uploadId: file.uploadId,
                });
                void deleteUpload(file.fileId);
            }
            setFiles((prev) => prev.filter((f) => f.id !== id));
        },
        [multipartAbortMutation]
    );

    const retryFile = useCallback(
        (id: string) => {
            updateFile(id, {
                status: 'pending',
                error: undefined,
            });
            // If not currently uploading, start processing
            if (!filesRef.current.some((f) => f.status === 'uploading')) {
                const file = filesRef.current.find((f) => f.id === id);
                if (file) {
                    setIsUploading(true);
                    const doRetry = async () => {
                        const current = filesRef.current.find(
                            (f) => f.id === id
                        );
                        if (!current || !current.file) {
                            setIsUploading(false);
                            return;
                        }
                        await runUpload(current);
                        setIsUploading(false);
                    };
                    void doRetry();
                }
            }
        },
        [updateFile, runUpload]
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
            setIsUploading(true);
            try {
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
                    updateFile(row.id, {
                        file,
                        status: 'pending',
                        error: undefined,
                    });
                    await uploadMultipartFile({
                        ...row,
                        file,
                        status: 'pending',
                    });
                }
                if (!hasResumedAny) {
                    toast.error(
                        rows.length > 1
                            ? "Couldn't reopen the files — re-add them to resume"
                            : "Couldn't reopen the file — re-add it to resume"
                    );
                }
            } finally {
                setIsUploading(false);
            }
        },
        [updateFile, uploadMultipartFile]
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
        ({ id, name, size, progress, status, error, isQuickResumable }) => ({
            id,
            name,
            size,
            progress,
            status,
            error,
            isQuickResumable,
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

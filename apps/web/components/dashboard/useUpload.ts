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
    isAbortError,
    isExpiredUrlError,
    isNetworkError,
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
}

interface InternalUploadFile extends UploadFile {
    // Null for an interrupted upload detected on reload — the bytes are gone
    // until the user re-adds the file, at which point we reattach and resume.
    file: File | null;
    fileId?: string;
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
    const confirmMutation = useMutation(
        trpc.files.confirmUpload.mutationOptions()
    );
    const multipartInitMutation = useMutation(
        trpc.files.multipart.init.mutationOptions()
    );
    const multipartCompleteMutation = useMutation(
        trpc.files.multipart.complete.mutationOptions()
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
        async (uploadFile: InternalUploadFile) => {
            const file = uploadFile.file;
            if (!file) return;
            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });

            try {
                const { fileId, uploadUrl } = await uploadMutation.mutateAsync({
                    name: file.name,
                    sizeBytes: file.size,
                    mimeType: file.type || undefined,
                });

                updateFile(uploadFile.id, { fileId });

                await xhrPut(uploadUrl, file, {
                    onProgress: (loaded, total) => {
                        updateFile(uploadFile.id, {
                            progress: Math.round((loaded / total) * 100),
                        });
                    },
                    signal: abortController.signal,
                });

                // Retry confirmUpload since the file data is already in S3
                await retryAsync(
                    () => confirmMutation.mutateAsync({ fileId }),
                    CONFIRM_RETRIES
                );

                updateFile(uploadFile.id, {
                    status: 'complete',
                    progress: 100,
                });
                await invalidateFileList();
            } catch (error) {
                if (isAbortError(error)) {
                    return;
                }
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
        async (uploadFile: InternalUploadFile) => {
            const file = uploadFile.file;
            if (!file) return;

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
                    });
                    updateFile(uploadFile.id, {
                        fileId,
                        uploadId,
                        chunkSize,
                        totalParts,
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

                // Retry complete since the parts are already in S3.
                await retryAsync(
                    () =>
                        multipartCompleteMutation.mutateAsync({
                            fileId: fileId!,
                            uploadId: uploadId!,
                            parts: mergeParts(completed),
                        }),
                    CONFIRM_RETRIES
                );

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
        (uploadFile: InternalUploadFile) =>
            uploadFile.size >= MULTIPART_THRESHOLD
                ? uploadMultipartFile(uploadFile)
                : uploadSingleFile(uploadFile),
        [uploadMultipartFile, uploadSingleFile]
    );

    const processQueue = useCallback(async () => {
        setIsUploading(true);

        for (const file of filesRef.current) {
            if (file.status !== 'pending') continue;

            // Re-read from ref to get latest state (file may have been removed)
            const current = filesRef.current.find((f) => f.id === file.id);
            if (!current || current.status !== 'pending' || !current.file) {
                continue;
            }

            await runUpload(current);
        }

        setIsUploading(false);
    }, [runUpload]);

    // Surface interrupted uploads found in IndexedDB on mount as `resumable`
    // rows. The bytes are gone, so they show until the user re-adds the file.
    // Runs once per mount; the setFiles dedupe (by fileId) keeps it idempotent
    // under React StrictMode's double-invoked effects, so no cancel flag needed.
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
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
                        file: null,
                        fileId: r.fileId,
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
                        await uploadMultipartFile(current);
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
    }, [uploadMultipartFile]);

    const addFiles = useCallback(async (fileList: FileList | null) => {
        if (!fileList) return;

        const incoming = Array.from(fileList);
        // Match each file against a persisted interrupted upload so a re-add
        // resumes from where S3 left off instead of starting over.
        const matches = await Promise.all(
            incoming.map((file) => findUploadByIdentity(toFileIdentity(file)))
        );

        setFiles((prev) => {
            // Reattach re-added files to their resumable rows (immutably), then
            // append rows for everything that didn't match an existing row.
            const reattach = new Map<string, File>();
            const appended: InternalUploadFile[] = [];

            incoming.forEach((file, i) => {
                const match = matches[i];
                const existing =
                    match && isResumable(match)
                        ? prev.find((f) => f.fileId === match.fileId)
                        : undefined;

                if (match && isResumable(match) && existing) {
                    // Re-add of an interrupted upload: queue it as resumable;
                    // clicking Upload continues from the last completed part.
                    reattach.set(existing.id, file);
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
                        fileId: match.fileId,
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
                });
            });

            const updated = prev.map((f) => {
                const file = reattach.get(f.id);
                return file
                    ? {
                          ...f,
                          file,
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

    // Expose only the public UploadFile shape (strip internal fields)
    const publicFiles: UploadFile[] = files.map(
        ({ id, name, size, progress, status, error }) => ({
            id,
            name,
            size,
            progress,
            status,
            error,
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
    };
}

// Wrapped so it's easy to reason about in non-browser test contexts; the engine
// only calls it after a network error to decide pause-vs-fail.
function navigatorIsOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
}

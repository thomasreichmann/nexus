'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';
import { xhrPut } from '@/lib/http/xhr';
import { retryAsync } from '@/lib/async/retry';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const MAX_CONCURRENT_CHUNKS = 3;
const MAX_CHUNK_RETRIES = 3;
const CONFIRM_RETRIES = 3;

export interface UploadFile {
    id: string;
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'complete' | 'error';
    error?: string;
}

interface InternalUploadFile extends UploadFile {
    fileId?: string;
    uploadId?: string;
    abortController?: AbortController;
}

export function useUpload() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const [files, setFiles] = useState<InternalUploadFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;

    const listOptions = trpc.files.list.queryOptions();
    const invalidateFileList = useCallback(
        () => queryClient.invalidateQueries({ queryKey: listOptions.queryKey }),
        [queryClient, listOptions.queryKey]
    );

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
            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });

            try {
                const { fileId, uploadUrl } = await uploadMutation.mutateAsync({
                    name: uploadFile.file.name,
                    sizeBytes: uploadFile.file.size,
                    mimeType: uploadFile.file.type || undefined,
                });

                updateFile(uploadFile.id, { fileId });

                await xhrPut(uploadUrl, uploadFile.file, {
                    contentType: uploadFile.file.type || undefined,
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
                if (
                    error instanceof DOMException &&
                    error.name === 'AbortError'
                ) {
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
            const abortController = new AbortController();
            updateFile(uploadFile.id, {
                status: 'uploading',
                abortController,
            });

            let fileId: string | undefined;
            let uploadId: string | undefined;

            try {
                const result = await multipartInitMutation.mutateAsync({
                    name: uploadFile.file.name,
                    sizeBytes: uploadFile.file.size,
                    mimeType: uploadFile.file.type || undefined,
                });

                fileId = result.fileId;
                uploadId = result.uploadId;
                const { partUrls, chunkSize } = result;

                updateFile(uploadFile.id, { fileId, uploadId });

                const totalChunks = partUrls.length;
                let completedChunks = 0;
                const parts: { partNumber: number; etag: string }[] = [];

                // Upload chunks with concurrency limit
                const chunkQueue = partUrls.map((url, i) => ({
                    url,
                    index: i,
                }));
                const inFlight = new Set<Promise<void>>();

                const uploadChunk = async (
                    url: string,
                    index: number
                ): Promise<void> => {
                    const start = index * chunkSize;
                    const end = Math.min(
                        start + chunkSize,
                        uploadFile.file.size
                    );
                    const chunk = uploadFile.file.slice(start, end);

                    const { etag } = await retryAsync(
                        () =>
                            xhrPut(url, chunk, {
                                signal: abortController.signal,
                            }),
                        MAX_CHUNK_RETRIES
                    );

                    parts.push({
                        partNumber: index + 1,
                        etag: etag!,
                    });

                    completedChunks++;
                    updateFile(uploadFile.id, {
                        progress: Math.round(
                            (completedChunks / totalChunks) * 100
                        ),
                    });
                };

                for (const { url, index } of chunkQueue) {
                    if (abortController.signal.aborted) {
                        throw new DOMException('Upload aborted', 'AbortError');
                    }

                    const promise = uploadChunk(url, index).finally(() => {
                        inFlight.delete(promise);
                    });
                    inFlight.add(promise);

                    if (inFlight.size >= MAX_CONCURRENT_CHUNKS) {
                        await Promise.race(inFlight);
                    }
                }

                await Promise.all(inFlight);

                // Sort parts by partNumber for S3
                parts.sort((a, b) => a.partNumber - b.partNumber);

                // Retry complete since file data is already in S3
                await retryAsync(
                    () =>
                        multipartCompleteMutation.mutateAsync({
                            fileId: fileId!,
                            uploadId: uploadId!,
                            parts,
                        }),
                    CONFIRM_RETRIES
                );

                updateFile(uploadFile.id, {
                    status: 'complete',
                    progress: 100,
                });
                await invalidateFileList();
            } catch (error) {
                if (
                    error instanceof DOMException &&
                    error.name === 'AbortError'
                ) {
                    // Abort the multipart upload on S3 if we have IDs
                    if (fileId && uploadId) {
                        multipartAbortMutation.mutate({ fileId, uploadId });
                    }
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
            multipartAbortMutation,
            updateFile,
            invalidateFileList,
        ]
    );

    const processQueue = useCallback(async () => {
        setIsUploading(true);

        for (const file of filesRef.current) {
            if (file.status !== 'pending') continue;

            // Re-read from ref to get latest state (file may have been removed)
            const current = filesRef.current.find((f) => f.id === file.id);
            if (!current || current.status !== 'pending') continue;

            if (current.file.size >= MULTIPART_THRESHOLD) {
                await uploadMultipartFile(current);
            } else {
                await uploadSingleFile(current);
            }
        }

        setIsUploading(false);
    }, [uploadSingleFile, uploadMultipartFile]);

    const addFiles = useCallback((fileList: FileList | null) => {
        if (!fileList) return;
        const newFiles: InternalUploadFile[] = Array.from(fileList).map(
            (file) => ({
                id: Math.random().toString(36).substring(7),
                file,
                progress: 0,
                status: 'pending' as const,
            })
        );
        setFiles((prev) => [...prev, ...newFiles]);
    }, []);

    const removeFile = useCallback((id: string) => {
        const file = filesRef.current.find((f) => f.id === id);
        if (file?.abortController) {
            file.abortController.abort();
        }
        setFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const clearFiles = useCallback(() => {
        for (const file of filesRef.current) {
            file.abortController?.abort();
        }
        setFiles([]);
    }, []);

    const cancelFile = useCallback((id: string) => {
        const file = filesRef.current.find((f) => f.id === id);
        if (file?.abortController) {
            file.abortController.abort();
        }
        setFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const retryFile = useCallback(
        (id: string) => {
            updateFile(id, {
                status: 'pending',
                progress: 0,
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
                        if (!current) {
                            setIsUploading(false);
                            return;
                        }
                        if (current.file.size >= MULTIPART_THRESHOLD) {
                            await uploadMultipartFile(current);
                        } else {
                            await uploadSingleFile(current);
                        }
                        setIsUploading(false);
                    };
                    void doRetry();
                }
            }
        },
        [updateFile, uploadSingleFile, uploadMultipartFile]
    );

    // Expose only the public UploadFile shape (strip internal fields)
    const publicFiles: UploadFile[] = files.map(
        ({ id, file, progress, status, error }) => ({
            id,
            file,
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

'use client';

import type React from 'react';
import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    Upload,
    X,
    FileIcon,
    CheckCircle,
    Loader2,
    AlertCircle,
    RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { xhrPut } from '@/lib/http/xhr';
import { retryAsync } from '@/lib/async/retry';

const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const MAX_CONCURRENT_CHUNKS = 3;
const MAX_CHUNK_RETRIES = 3;

interface UploadFile {
    id: string;
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'complete' | 'error';
    error?: string;
    s3Key?: string;
    abortController?: AbortController;
}

async function apiCall(body: Record<string, unknown>) {
    const res = await fetch('/api/dev/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

export default function DevUploadPage() {
    const [files, setFiles] = useState<UploadFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const filesRef = useRef(files);
    filesRef.current = files;

    const updateFile = useCallback(
        (id: string, updates: Partial<UploadFile>) => {
            setFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
            );
        },
        []
    );

    const uploadSingle = useCallback(
        async (uf: UploadFile) => {
            const abort = new AbortController();
            updateFile(uf.id, { status: 'uploading', abortController: abort });

            try {
                const { key, uploadUrl } = await apiCall({
                    action: 'presign',
                    filename: uf.file.name,
                    sizeBytes: uf.file.size,
                    mimeType: uf.file.type || undefined,
                });

                updateFile(uf.id, { s3Key: key });

                await xhrPut(uploadUrl, uf.file, {
                    onProgress: (loaded, total) =>
                        updateFile(uf.id, {
                            progress: Math.round((loaded / total) * 100),
                        }),
                    signal: abort.signal,
                });

                updateFile(uf.id, { status: 'complete', progress: 100 });
            } catch (error) {
                if (
                    error instanceof DOMException &&
                    error.name === 'AbortError'
                )
                    return;
                updateFile(uf.id, {
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Upload failed',
                });
            }
        },
        [updateFile]
    );

    const uploadMultipart = useCallback(
        async (uf: UploadFile) => {
            const abort = new AbortController();
            updateFile(uf.id, { status: 'uploading', abortController: abort });

            try {
                const { key, uploadId, partUrls, chunkSize } = await apiCall({
                    action: 'multipart-init',
                    filename: uf.file.name,
                    sizeBytes: uf.file.size,
                    mimeType: uf.file.type || undefined,
                });

                updateFile(uf.id, { s3Key: key });

                const totalChunks = partUrls.length;
                let completedChunks = 0;
                const parts: { partNumber: number; etag: string }[] = [];
                const inFlight = new Set<Promise<void>>();

                for (let i = 0; i < totalChunks; i++) {
                    if (abort.signal.aborted)
                        throw new DOMException('Upload aborted', 'AbortError');

                    const start = i * chunkSize;
                    const chunk = uf.file.slice(
                        start,
                        Math.min(start + chunkSize, uf.file.size)
                    );

                    const promise = (async () => {
                        const { etag } = await retryAsync(
                            () =>
                                xhrPut(partUrls[i], chunk, {
                                    signal: abort.signal,
                                }),
                            MAX_CHUNK_RETRIES
                        );
                        parts.push({ partNumber: i + 1, etag: etag! });
                        completedChunks++;
                        updateFile(uf.id, {
                            progress: Math.round(
                                (completedChunks / totalChunks) * 100
                            ),
                        });
                    })().finally(() => inFlight.delete(promise));

                    inFlight.add(promise);
                    if (inFlight.size >= MAX_CONCURRENT_CHUNKS)
                        await Promise.race(inFlight);
                }

                await Promise.all(inFlight);

                parts.sort((a, b) => a.partNumber - b.partNumber);
                await retryAsync(
                    () =>
                        apiCall({
                            action: 'multipart-complete',
                            key,
                            uploadId,
                            parts,
                        }),
                    3
                );

                updateFile(uf.id, { status: 'complete', progress: 100 });
            } catch (error) {
                if (
                    error instanceof DOMException &&
                    error.name === 'AbortError'
                )
                    return;
                updateFile(uf.id, {
                    status: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Upload failed',
                });
            }
        },
        [updateFile]
    );

    const startUpload = useCallback(async () => {
        setIsUploading(true);
        for (const f of filesRef.current) {
            if (f.status !== 'pending') continue;
            const current = filesRef.current.find((x) => x.id === f.id);
            if (!current || current.status !== 'pending') continue;
            if (current.file.size >= MULTIPART_THRESHOLD) {
                await uploadMultipart(current);
            } else {
                await uploadSingle(current);
            }
        }
        setIsUploading(false);
    }, [uploadSingle, uploadMultipart]);

    const addFiles = useCallback((fileList: FileList | null) => {
        if (!fileList) return;
        setFiles((prev) => [
            ...prev,
            ...Array.from(fileList).map((file) => ({
                id: Math.random().toString(36).substring(7),
                file,
                progress: 0,
                status: 'pending' as const,
            })),
        ]);
    }, []);

    const cancelFile = useCallback((id: string) => {
        const f = filesRef.current.find((x) => x.id === id);
        f?.abortController?.abort();
        setFiles((prev) => prev.filter((x) => x.id !== id));
    }, []);

    const retryFile = useCallback(
        (id: string) => {
            updateFile(id, {
                status: 'pending',
                progress: 0,
                error: undefined,
            });
            if (!filesRef.current.some((f) => f.status === 'uploading')) {
                setIsUploading(true);
                const doRetry = async () => {
                    const current = filesRef.current.find((f) => f.id === id);
                    if (!current) {
                        setIsUploading(false);
                        return;
                    }
                    if (current.file.size >= MULTIPART_THRESHOLD) {
                        await uploadMultipart(current);
                    } else {
                        await uploadSingle(current);
                    }
                    setIsUploading(false);
                };
                void doRetry();
            }
        },
        [updateFile, uploadSingle, uploadMultipart]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragOver(false);
            addFiles(e.dataTransfer.files);
        },
        [addFiles]
    );

    const pendingFiles = files.filter((f) => f.status === 'pending');
    const hasCompleted = files.some((f) => f.status === 'complete');

    return (
        <div className="mx-auto max-w-2xl p-8">
            <h1 className="mb-2 text-2xl font-bold">Upload Test</h1>
            <p className="mb-6 text-sm text-muted-foreground">
                Temporary dev page — uploads go directly to S3 Standard. No auth
                or DB records. Files under 100MB use single PUT, larger files
                use multipart.
            </p>

            <div className="space-y-6">
                <Card
                    className={cn(
                        'border-2 border-dashed transition-colors',
                        isDragOver
                            ? 'border-primary bg-primary/5'
                            : 'border-border'
                    )}
                >
                    <CardContent className="p-0">
                        <div
                            onDrop={handleDrop}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragOver(true);
                            }}
                            onDragLeave={() => setIsDragOver(false)}
                            className="flex flex-col items-center justify-center px-6 py-16"
                        >
                            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                                <Upload className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="mb-2 text-lg font-semibold">
                                Drop files here to upload
                            </h3>
                            <p className="mb-4 text-sm text-muted-foreground">
                                or click to browse your computer
                            </p>
                            <label>
                                <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => addFiles(e.target.files)}
                                    disabled={isUploading}
                                />
                                <Button
                                    variant="outline"
                                    disabled={isUploading}
                                    nativeButton={false}
                                    render={<span />}
                                >
                                    Browse files
                                </Button>
                            </label>
                        </div>
                    </CardContent>
                </Card>

                {files.length > 0 && (
                    <Card>
                        <CardContent className="p-6">
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="font-semibold">
                                    Files ({files.length})
                                </h3>
                                {!isUploading && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            for (const f of filesRef.current)
                                                f.abortController?.abort();
                                            setFiles([]);
                                        }}
                                    >
                                        Clear all
                                    </Button>
                                )}
                            </div>
                            <div className="space-y-3">
                                {files.map((file) => (
                                    <div
                                        key={file.id}
                                        className="flex items-center gap-3 rounded-lg border border-border p-3"
                                    >
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                                            {file.status === 'complete' ? (
                                                <CheckCircle className="h-5 w-5 text-green-500" />
                                            ) : file.status === 'error' ? (
                                                <AlertCircle className="h-5 w-5 text-destructive" />
                                            ) : file.status === 'uploading' ? (
                                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                            ) : (
                                                <FileIcon className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-medium">
                                                {file.file.name}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                {formatBytes(file.file.size)}
                                            </p>
                                            {file.status === 'uploading' && (
                                                <Progress
                                                    value={file.progress}
                                                    className="mt-2 h-1"
                                                />
                                            )}
                                            {file.status === 'error' &&
                                                file.error && (
                                                    <p className="mt-1 text-xs text-destructive">
                                                        {file.error}
                                                    </p>
                                                )}
                                            {file.status === 'complete' &&
                                                file.s3Key && (
                                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                                        {file.s3Key}
                                                    </p>
                                                )}
                                        </div>
                                        {file.status === 'pending' &&
                                            !isUploading && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        setFiles((prev) =>
                                                            prev.filter(
                                                                (f) =>
                                                                    f.id !==
                                                                    file.id
                                                            )
                                                        )
                                                    }
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            )}
                                        {file.status === 'uploading' && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    cancelFile(file.id)
                                                }
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                        {file.status === 'error' && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    retryFile(file.id)
                                                }
                                            >
                                                <RotateCcw className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {pendingFiles.length > 0 && (
                                <div className="mt-6 border-t border-border pt-6">
                                    <Button
                                        onClick={startUpload}
                                        disabled={isUploading}
                                    >
                                        {isUploading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Uploading...
                                            </>
                                        ) : (
                                            <>
                                                <Upload className="mr-2 h-4 w-4" />
                                                Upload {pendingFiles.length}{' '}
                                                {pendingFiles.length === 1
                                                    ? 'file'
                                                    : 'files'}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            )}
                            {hasCompleted &&
                                pendingFiles.length === 0 &&
                                !isUploading && (
                                    <p className="mt-6 text-sm font-medium text-green-500">
                                        All files uploaded successfully!
                                    </p>
                                )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}

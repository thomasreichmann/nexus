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
    PauseCircle,
    History,
    Play,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import {
    isFileSystemAccessSupported,
    pickFilesWithHandles,
    pickedFilesFromDataTransfer,
} from '@/lib/upload/fileSystemAccess';
import { useUpload } from './useUpload';

export function UploadZone() {
    const {
        files,
        isUploading,
        addFiles,
        removeFile,
        clearFiles,
        startUpload,
        cancelFile,
        retryFile,
        resumeWithHandle,
        resumeAllWithHandles,
    } = useUpload();

    const [isDragOver, setIsDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragOver(false);
            // Read the DataTransfer synchronously — its items are only live
            // during the event — then queue the files (with handles when present).
            void pickedFilesFromDataTransfer(e.dataTransfer).then(addFiles);
        },
        [addFiles]
    );

    // On Chromium the picker captures persistable handles for zero-touch resume;
    // elsewhere it falls through to the plain file input (the re-add path). Decided
    // at click time so there's no SSR/client mismatch and no render-time state.
    const handleBrowse = useCallback(() => {
        if (isFileSystemAccessSupported()) {
            void pickFilesWithHandles().then((picked) => {
                if (picked.length > 0) void addFiles(picked);
            });
        } else {
            inputRef.current?.click();
        }
    }, [addFiles]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    const estimatedCost = (totalSize / (1024 * 1024 * 1024)) * 0.01; // $0.01 per GB per month
    const pendingFiles = files.filter((f) => f.status === 'pending');
    const hasCompletedFiles = files.some((f) => f.status === 'complete');
    const quickResumable = files.filter(
        (f) => f.status === 'resumable' && f.isQuickResumable
    );

    return (
        <div className="space-y-6">
            <Card
                className={cn(
                    'border-2 border-dashed transition-colors',
                    isDragOver ? 'border-primary bg-primary/5' : 'border-border'
                )}
            >
                <CardContent className="p-0">
                    <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
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
                        {/* Always rendered (hidden) as the non-Chromium fallback
                            and the programmatic seam for tests; the picker path
                            below is what captures resumable handles. */}
                        <input
                            ref={inputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                                const picked = Array.from(
                                    e.target.files ?? []
                                ).map((file) => ({ file }));
                                void addFiles(picked);
                                // Allow re-selecting the same file (e.g. to re-add
                                // an interrupted upload) to fire onChange again.
                                e.target.value = '';
                            }}
                            disabled={isUploading}
                        />
                        <Button
                            variant="outline"
                            disabled={isUploading}
                            onClick={handleBrowse}
                        >
                            Browse files
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {files.length > 0 && (
                <Card>
                    <CardContent className="p-6">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="font-semibold">
                                Selected Files ({files.length})
                            </h3>
                            {!isUploading && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearFiles}
                                >
                                    Clear all
                                </Button>
                            )}
                        </div>
                        {quickResumable.length > 0 && (
                            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                                <div className="flex items-center gap-2 text-sm">
                                    <History className="h-4 w-4 shrink-0 text-amber-500" />
                                    <span>
                                        <span className="font-medium">
                                            {quickResumable.length}
                                        </span>{' '}
                                        interrupted{' '}
                                        {quickResumable.length === 1
                                            ? 'upload'
                                            : 'uploads'}{' '}
                                        ready to resume — no re-selecting
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={resumeAllWithHandles}
                                    disabled={isUploading}
                                >
                                    <Play className="mr-2 h-4 w-4" />
                                    Resume all
                                </Button>
                            </div>
                        )}
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
                                        ) : file.status === 'paused' ? (
                                            <PauseCircle className="h-5 w-5 text-amber-500" />
                                        ) : file.status === 'resumable' ? (
                                            <History className="h-5 w-5 text-amber-500" />
                                        ) : file.status === 'uploading' ? (
                                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                        ) : (
                                            <FileIcon className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate font-medium">
                                            {file.name}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {formatBytes(file.size)}
                                        </p>
                                        {(file.status === 'uploading' ||
                                            file.status === 'paused' ||
                                            file.status === 'resumable') && (
                                            <Progress
                                                value={file.progress}
                                                className="mt-2 h-1"
                                            />
                                        )}
                                        {file.status === 'paused' && (
                                            <p className="mt-1 text-xs text-amber-600">
                                                Paused — waiting for your
                                                connection
                                            </p>
                                        )}
                                        {file.status === 'resumable' && (
                                            <p className="mt-1 text-xs text-amber-600">
                                                {file.isQuickResumable
                                                    ? 'Interrupted — resume in one click'
                                                    : 'Interrupted — re-add this file to resume'}
                                            </p>
                                        )}
                                        {file.status === 'error' &&
                                            file.error && (
                                                <p className="mt-1 text-xs text-destructive">
                                                    {file.error}
                                                </p>
                                            )}
                                    </div>
                                    {file.status === 'pending' &&
                                        !isUploading && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    removeFile(file.id)
                                                }
                                            >
                                                <X className="h-4 w-4" />
                                                <span className="sr-only">
                                                    Remove
                                                </span>
                                            </Button>
                                        )}
                                    {file.status === 'resumable' &&
                                        file.isQuickResumable && (
                                            <Button
                                                size="sm"
                                                onClick={() =>
                                                    resumeWithHandle(file.id)
                                                }
                                                disabled={isUploading}
                                            >
                                                <Play className="mr-2 h-4 w-4" />
                                                Resume
                                            </Button>
                                        )}
                                    {(file.status === 'uploading' ||
                                        file.status === 'paused' ||
                                        file.status === 'resumable') && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => cancelFile(file.id)}
                                        >
                                            <X className="h-4 w-4" />
                                            <span className="sr-only">
                                                Cancel upload
                                            </span>
                                        </Button>
                                    )}
                                    {file.status === 'error' && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => retryFile(file.id)}
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                            <span className="sr-only">
                                                Retry upload
                                            </span>
                                        </Button>
                                    )}
                                    {file.status === 'complete' && (
                                        <span className="text-xs font-medium text-green-500">
                                            Uploaded
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                                <p className="text-sm">
                                    <span className="text-muted-foreground">
                                        Total size:
                                    </span>{' '}
                                    <span className="font-medium">
                                        {formatBytes(totalSize)}
                                    </span>
                                </p>
                                <p className="text-sm">
                                    <span className="text-muted-foreground">
                                        Est. monthly cost:
                                    </span>{' '}
                                    <span className="font-medium">
                                        ${estimatedCost.toFixed(2)}
                                    </span>
                                </p>
                            </div>
                            {pendingFiles.length > 0 && (
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
                            )}
                            {hasCompletedFiles &&
                                pendingFiles.length === 0 &&
                                !isUploading && (
                                    <p className="text-sm font-medium text-green-500">
                                        All files uploaded successfully!
                                    </p>
                                )}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

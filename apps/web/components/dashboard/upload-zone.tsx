'use client';

import type React from 'react';
import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import {
    isDirectoryPickerSupported,
    isFileSystemAccessSupported,
    pickFilesWithHandles,
    pickFolderWithHandles,
    pickedFilesFromDataTransfer,
    pickedFilesFromDirectoryInput,
    type PickedFileBatch,
} from '@/lib/upload/fileSystemAccess';
import { MAX_FILES_PER_DROP } from '@/lib/upload/limits';
import { waveProgress } from '@/lib/upload/parts';
import { preflightQuota } from '@/lib/upload/preflight';
import { getImagePreviewUrl } from '@/lib/upload/thumbnails';
import { CancelUploadDialog } from './CancelUploadDialog';
import { MiddleTruncateName } from './MiddleTruncateName';
import { useUpload, type UploadFile, type UploadStatus } from './useUpload';

// Formats the browser can decode natively — RAW files (NEF/CR3/ARW/…) carry
// an empty or opaque mime type and fall through to the plain icon tile; their
// real thumbnails arrive server-side after upload. TIFF is image/* but most
// browsers can't render it.
const DECODABLE_IMAGE_TYPE = /^image\/(?!tiff)/;

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
    // Row awaiting cancel confirmation — the destructive X (in-flight or
    // resumable rows) opens the dialog instead of dropping the row outright.
    const [cancelCandidateId, setCancelCandidateId] = useState<string | null>(
        null
    );
    const inputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // The one queueing seam for every ingest gesture. Feedback lives here so
    // no path can regress into the silent ignore #388 was about: a capped walk
    // says what it kept, an empty folder says it had nothing.
    const addPickedBatch = useCallback(
        ({ files: picked, truncated, emptySelection }: PickedFileBatch) => {
            if (truncated) {
                toast.info(
                    `Large selection — only the first ${MAX_FILES_PER_DROP.toLocaleString()} files were added.`
                );
            }
            if (picked.length === 0) {
                if (emptySelection)
                    toast.info('No files found in that folder.');
                return;
            }
            void addFiles(picked);
        },
        [addFiles]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragOver(false);
            // The DataTransfer is read synchronously inside — its items are
            // only live during the event.
            void pickedFilesFromDataTransfer(e.dataTransfer).then(
                addPickedBatch
            );
        },
        [addPickedBatch]
    );

    // On Chromium the picker captures persistable handles for zero-touch resume;
    // elsewhere it falls through to the plain file input (the re-add path). Decided
    // at click time so there's no SSR/client mismatch and no render-time state.
    const handleBrowse = useCallback(() => {
        if (isFileSystemAccessSupported()) {
            void pickFilesWithHandles().then(addPickedBatch);
        } else {
            inputRef.current?.click();
        }
    }, [addPickedBatch]);

    // Folder flavor of the same split: native directory picker on Chromium,
    // hidden `webkitdirectory` input everywhere else.
    const handleBrowseFolder = useCallback(() => {
        if (isDirectoryPickerSupported()) {
            void pickFolderWithHandles().then(addPickedBatch);
        } else {
            folderInputRef.current?.click();
        }
    }, [addPickedBatch]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const trpc = useTRPC();
    // Cached by the sidebar's identical query most of the time; gives the
    // summary an honest "how much room is left" figure.
    const { data: usage } = useQuery(trpc.storage.getUsage.queryOptions());

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    const pendingFiles = files.filter((f) => f.status === 'pending');
    const completedCount = files.filter((f) => f.status === 'complete').length;
    const errorCount = files.filter((f) => f.status === 'error').length;
    const pausedCount = files.filter((f) => f.status === 'paused').length;
    const activeCount = files.filter(
        (f) => f.status === 'queued' || f.status === 'uploading'
    ).length;
    // The wave is live while the pool holds rows; `isUploading` alone would
    // blink off during the batch-creation await before any row is admitted.
    const hasActiveWave = isUploading || activeCount > 0;
    const attemptedCount = completedCount + errorCount;
    // The outcome line waits for a settled queue: nothing moving, nothing the
    // user still has to submit, nothing parked waiting for a reconnect.
    const showOutcome =
        !hasActiveWave &&
        pendingFiles.length === 0 &&
        pausedCount === 0 &&
        attemptedCount > 0;
    const quickResumable = files.filter(
        (f) => f.status === 'resumable' && f.isQuickResumable
    );
    // Only while the row is still in a guarded state: if it finishes (or
    // errors out) with the dialog open, the dialog auto-closes rather than
    // dropping a settled row under "progress will be thrown away" copy.
    const cancelCandidate =
        files.find(
            (f) =>
                f.id === cancelCandidateId &&
                (f.status === 'uploading' ||
                    f.status === 'paused' ||
                    f.status === 'resumable')
        ) ?? null;

    // Pre-flight quota: judge only the bytes the Upload button would submit.
    // Resumable rows are excluded — their landed parts are already counted in
    // `usedBytes`, so summing their full size would double-count.
    const pendingBytes = pendingFiles.reduce((acc, f) => acc + f.size, 0);
    const availableBytes = usage
        ? Math.max(usage.quotaBytes - usage.usedBytes, 0)
        : null;
    const preflight =
        usage && pendingFiles.length > 0
            ? preflightQuota({
                  pendingBytes,
                  usedBytes: usage.usedBytes,
                  quotaBytes: usage.quotaBytes,
              })
            : 'ok';

    // The aggregate header's view of the wave — at 50+ rows the per-row bars
    // scroll out of sight, so the wave needs one bar that means something.
    // One row set feeds both the bar and the "X of Y" caption, so they can
    // never describe different waves (paused rows are in: a row parked by a
    // connection drop is still the wave's work).
    const waveRows = files.filter(
        (f) => f.status !== 'pending' && f.status !== 'resumable'
    );
    const wavePercent = waveProgress(waveRows);

    // The queue list is contained and virtualized: page scroll must not grow
    // with the selection (#390), and neither may the DOM — reconciling 500
    // mounted rows is what melted this page. Overscan is generous so small
    // selections (a dozen rows) render fully.
    const listScrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: files.length,
        getScrollElement: () => listScrollRef.current,
        estimateSize: () => 78,
        overscan: 12,
        getItemKey: (index) => files[index].id,
    });

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
                            Drop files or folders here to upload
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
                            data-testid="file-input"
                            onChange={(e) => {
                                const picked = Array.from(
                                    e.target.files ?? []
                                ).map((file) => ({ file }));
                                void addFiles(picked);
                                // Allow re-selecting the same file (e.g. to re-add
                                // an interrupted upload) to fire onChange again.
                                e.target.value = '';
                            }}
                        />
                        {/* The folder twin of the input above. `webkitdirectory`
                            isn't in React's prop types, hence the spread. */}
                        <input
                            ref={folderInputRef}
                            type="file"
                            className="hidden"
                            data-testid="folder-input"
                            {...{ webkitdirectory: '' }}
                            onChange={(e) => {
                                if (e.target.files) {
                                    addPickedBatch(
                                        pickedFilesFromDirectoryInput(
                                            e.target.files
                                        )
                                    );
                                }
                                e.target.value = '';
                            }}
                        />
                        {/* Deliberately enabled mid-wave (drag-drop always
                            was): added files queue as pending and the Upload
                            button lets them join the running wave. */}
                        <div className="flex flex-wrap items-center justify-center gap-3">
                            <Button variant="outline" onClick={handleBrowse}>
                                Browse files
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleBrowseFolder}
                            >
                                Browse folder
                            </Button>
                        </div>
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
                        {hasActiveWave && (
                            <div className="mb-4 space-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <p>
                                        <span className="text-muted-foreground">
                                            Uploading —{' '}
                                        </span>
                                        <span className="font-medium">
                                            {completedCount} of{' '}
                                            {waveRows.length} files
                                        </span>
                                        {errorCount > 0 && (
                                            <span className="text-destructive">
                                                {' '}
                                                · {errorCount} failed
                                            </span>
                                        )}
                                    </p>
                                    <span className="font-medium tabular-nums">
                                        {wavePercent}%
                                    </span>
                                </div>
                                <Progress
                                    value={wavePercent}
                                    className="h-1.5"
                                />
                            </div>
                        )}
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
                        {/* Contained scroll: the page must not grow with the
                            selection. Rows are absolutely positioned by the
                            virtualizer and measured (heights vary by status),
                            with pb-3 standing in for the old space-y-3. */}
                        <div
                            ref={listScrollRef}
                            data-testid="upload-queue"
                            className="max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain"
                        >
                            <div
                                className="relative"
                                style={{
                                    height: rowVirtualizer.getTotalSize(),
                                }}
                            >
                                {rowVirtualizer
                                    .getVirtualItems()
                                    .map((virtualRow) => {
                                        const file = files[virtualRow.index];
                                        return (
                                            <div
                                                key={file.id}
                                                ref={
                                                    rowVirtualizer.measureElement
                                                }
                                                data-index={virtualRow.index}
                                                data-testid="upload-queue-row"
                                                className="absolute inset-x-0 top-0 pb-3"
                                                style={{
                                                    transform: `translateY(${virtualRow.start}px)`,
                                                }}
                                            >
                                                {/* Cancel is guarded, unlike
                                                    Remove: that X aborts the
                                                    S3 session and deletes the
                                                    resume record, so the row
                                                    opens the confirm dialog
                                                    instead (#389). */}
                                                <UploadQueueRow
                                                    file={file}
                                                    isUploading={isUploading}
                                                    onRemove={removeFile}
                                                    onCancel={
                                                        setCancelCandidateId
                                                    }
                                                    onRetry={retryFile}
                                                    onResume={resumeWithHandle}
                                                />
                                            </div>
                                        );
                                    })}
                            </div>
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
                                {usage && (
                                    <p className="text-sm">
                                        <span className="text-muted-foreground">
                                            Storage available:
                                        </span>{' '}
                                        <span className="font-medium">
                                            {formatBytes(
                                                Math.max(
                                                    usage.quotaBytes -
                                                        usage.usedBytes,
                                                    0
                                                )
                                            )}
                                        </span>
                                    </p>
                                )}
                                {preflight === 'blocked' && (
                                    <p className="text-sm text-destructive">
                                        Not enough storage — these files need{' '}
                                        {formatBytes(pendingBytes)}, but only{' '}
                                        {formatBytes(availableBytes ?? 0)} is
                                        available.
                                    </p>
                                )}
                                {preflight === 'over-limit' && (
                                    <p className="text-sm text-amber-600">
                                        This upload will put you over your
                                        storage limit.
                                    </p>
                                )}
                                {preflight === 'near-limit' && (
                                    <p className="text-sm text-amber-600">
                                        This upload will use most of your
                                        remaining storage.
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                {/* Persistent live region so the wave's
                                    outcome is announced, not just painted. */}
                                <div aria-live="polite">
                                    {showOutcome &&
                                        (errorCount === 0 ? (
                                            <p className="text-sm font-medium text-green-500">
                                                All files uploaded successfully!
                                            </p>
                                        ) : (
                                            <p className="text-sm font-medium text-amber-600">
                                                {completedCount} of{' '}
                                                {attemptedCount} files uploaded
                                                — {errorCount} failed
                                            </p>
                                        ))}
                                </div>
                                {showOutcome && completedCount > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        render={
                                            <Link href="/dashboard/files" />
                                        }
                                    >
                                        View files
                                    </Button>
                                )}
                                {pendingFiles.length > 0 ? (
                                    <Button
                                        onClick={startUpload}
                                        // Only past the soft cap, where the
                                        // server would reject the wave anyway;
                                        // over-limit selections inside the 5%
                                        // grace band still upload.
                                        disabled={preflight === 'blocked'}
                                    >
                                        <Upload className="mr-2 h-4 w-4" />
                                        Upload {pendingFiles.length}{' '}
                                        {pendingFiles.length === 1
                                            ? 'file'
                                            : 'files'}
                                    </Button>
                                ) : hasActiveWave ? (
                                    <Button disabled>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Uploading...
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
            <CancelUploadDialog
                open={cancelCandidate !== null}
                onOpenChange={(open) => {
                    if (!open) setCancelCandidateId(null);
                }}
                fileName={cancelCandidate?.name ?? null}
                onConfirm={() => {
                    if (cancelCandidate) cancelFile(cancelCandidate.id);
                    setCancelCandidateId(null);
                }}
            />
        </div>
    );
}

interface UploadQueueRowProps {
    file: UploadFile;
    isUploading: boolean;
    onRemove: (id: string) => void;
    onCancel: (id: string) => void;
    onRetry: (id: string) => void;
    onResume: (id: string) => void;
}

/**
 * One queue row, memoized: a progress tick re-renders only the row it moved.
 * That only holds because `useUpload` hands out identity-stable row objects
 * (unchanged rows project to the same reference) and stable callbacks — the
 * memo is the last link in that chain, not a local optimization.
 */
const UploadQueueRow = memo(function UploadQueueRow({
    file,
    isUploading,
    onRemove,
    onCancel,
    onRetry,
    onResume,
}: UploadQueueRowProps) {
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <UploadPreviewTile blob={file.previewFile} status={file.status} />
            <div className="flex-1 min-w-0">
                <MiddleTruncateName name={file.name} className="font-medium" />
                <p className="text-sm text-muted-foreground">
                    {formatBytes(file.size)}
                </p>
                {(file.status === 'uploading' ||
                    file.status === 'paused' ||
                    file.status === 'resumable') && (
                    <Progress value={file.progress} className="mt-2 h-1" />
                )}
                {file.status === 'queued' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                        Waiting to upload
                    </p>
                )}
                {file.status === 'paused' && (
                    <p className="mt-1 text-xs text-amber-600">
                        Paused — waiting for your connection
                    </p>
                )}
                {file.status === 'resumable' && (
                    <p className="mt-1 text-xs text-amber-600">
                        {file.isQuickResumable
                            ? 'Interrupted — resume in one click'
                            : 'Interrupted — re-add this file to resume'}
                    </p>
                )}
                {file.status === 'error' && file.error && (
                    <p className="mt-1 text-xs text-destructive">
                        {file.error}
                    </p>
                )}
            </div>
            {/* Removable while queued too: the pool re-reads the row at start
                time, so a removed row is simply skipped. */}
            {(file.status === 'pending' || file.status === 'queued') && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(file.id)}
                >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Remove</span>
                </Button>
            )}
            {file.status === 'resumable' && file.isQuickResumable && (
                <Button
                    size="sm"
                    onClick={() => onResume(file.id)}
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
                    onClick={() => onCancel(file.id)}
                >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Cancel upload</span>
                </Button>
            )}
            {file.status === 'error' && (
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRetry(file.id)}
                >
                    <RotateCcw className="h-4 w-4" />
                    <span className="sr-only">Retry upload</span>
                </Button>
            )}
            {file.status === 'complete' && (
                <span className="text-xs font-medium text-green-500">
                    Uploaded
                </span>
            )}
        </div>
    );
});

/**
 * The row's 10x10 leading tile. Browser-decodable files get a local blob
 * preview in the same fixed box (no reflow, no server round-trip); the
 * status icon keeps rendering on top of a scrim so state stays legible.
 * Rows restored after a reload have no bytes (blob null) and keep the
 * plain icon tile.
 */
function UploadPreviewTile({
    blob,
    status,
}: {
    blob?: File | null;
    status: UploadStatus;
}) {
    const kind = !blob
        ? null
        : DECODABLE_IMAGE_TYPE.test(blob.type)
          ? ('image' as const)
          : blob.type.startsWith('video/')
            ? ('video' as const)
            : null;

    // Images render a tile-sized thumbnail (decoded once, cached per File in
    // lib/upload/thumbnails) — never the raw file, whose full-size decode is
    // what buried the page under a 50-photo selection (#390).
    const imageUrl = useImagePreviewUrl(blob && kind === 'image' ? blob : null);
    // Videos keep a per-mount object URL: metadata preload paints the first
    // frame without a retained decode, and virtualization bounds how many
    // <video> elements exist at once.
    const videoUrl = useMemo(
        () => (blob && kind === 'video' ? URL.createObjectURL(blob) : null),
        [blob, kind]
    );
    useEffect(() => {
        if (!videoUrl) return;
        return () => URL.revokeObjectURL(videoUrl);
    }, [videoUrl]);
    const previewUrl = imageUrl ?? videoUrl;

    // Pending and queued rows keep a clean preview — the scrim + icon only
    // takes over once the row has a state worth signalling.
    const showStatusIcon =
        (status !== 'pending' && status !== 'queued') || !previewUrl;

    return (
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {previewUrl && kind === 'image' && (
                // Local blob URL — next/image has nothing to optimize here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={previewUrl}
                    alt=""
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                />
            )}
            {previewUrl && kind === 'video' && (
                // First frame as a still: metadata preload paints it, nothing
                // ever plays.
                <video
                    src={previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 size-full object-cover"
                />
            )}
            {showStatusIcon && (
                <>
                    {previewUrl && (
                        <div className="absolute inset-0 bg-black/45" />
                    )}
                    <span className="relative">
                        {status === 'complete' ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : status === 'error' ? (
                            <AlertCircle className="h-5 w-5 text-destructive" />
                        ) : status === 'paused' ? (
                            <PauseCircle className="h-5 w-5 text-amber-500" />
                        ) : status === 'resumable' ? (
                            <History className="h-5 w-5 text-amber-500" />
                        ) : status === 'uploading' ? (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        ) : (
                            <FileIcon className="h-5 w-5 text-muted-foreground" />
                        )}
                    </span>
                </>
            )}
        </div>
    );
}

/* Resolves a file's cached tile thumbnail. Starts null (the tile shows its
   icon) and stays null for files that can't be decoded. The resolved URL is
   stored with the blob it belongs to and matched on read, so a row whose blob
   changes can't flash the previous file's thumbnail. */
function useImagePreviewUrl(blob: File | null): string | null {
    const [preview, setPreview] = useState<{
        blob: File;
        url: string | null;
    } | null>(null);
    useEffect(() => {
        if (!blob) return;
        let isActive = true;
        void getImagePreviewUrl(blob).then((url) => {
            if (isActive) setPreview({ blob, url });
        });
        return () => {
            isActive = false;
        };
    }, [blob]);
    return blob && preview?.blob === blob ? preview.url : null;
}

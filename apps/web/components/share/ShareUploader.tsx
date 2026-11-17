'use client';

import type React from 'react';
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
    AlertCircle,
    CheckCircle,
    Copy,
    FileIcon,
    Link2,
    Upload,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MiddleTruncateName } from '@/components/dashboard/MiddleTruncateName';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import { countLabel, formatBytes } from '@/lib/format';
import { xhrPut } from '@/lib/http/xhr';
import { MAX_SHARE_BYTES } from '@/lib/share/limits';
import {
    checkSelection,
    selectionProblemMessage,
    totalSize,
} from '@/lib/share/policy';
import {
    createShareUploadSession,
    runShareUpload,
    type ShareLink,
} from '@/lib/share/upload';
import { toastContext } from '@/lib/trpc/error-link';
import { useTRPC } from '@/lib/trpc/client';
import { isAbortError, uploadErrorMessage } from '@/lib/upload/errors';
import { pickedFilesFromDataTransfer } from '@/lib/upload/fileSystemAccess';

/**
 * `selecting`: files can still be added and removed.
 * `uploading`: bytes are moving.
 * `stopped`: a link was minted but not every file arrived (a failure, or the
 * user's cancel). The selection is locked to that link; the way on is to
 * resume it or start over.
 * `done`: the link is live.
 */
type Phase = 'selecting' | 'uploading' | 'stopped' | 'done';

export function ShareUploader() {
    const trpc = useTRPC();
    // Errors are shown in the card, next to what they are about.
    const quiet = { trpc: toastContext({ skipToast: true }) };
    const createShare = useMutation(trpc.shares.create.mutationOptions(quiet));
    const completeShare = useMutation(
        trpc.shares.complete.mutationOptions(quiet)
    );

    const [files, setFiles] = useState<File[]>([]);
    const [phase, setPhase] = useState<Phase>('selecting');
    const [sentBytes, setSentBytes] = useState<number[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [link, setLink] = useState<ShareLink | null>(null);
    const sessionRef = useRef(createShareUploadSession());
    const abortRef = useRef<AbortController | null>(null);

    const selectedBytes = totalSize(files);
    const selectionProblem = checkSelection(files);

    function addFiles(picked: File[]) {
        if (picked.length === 0) return;
        setError(null);
        setFiles((current) => [...current, ...picked]);
    }

    function removeFile(index: number) {
        setError(null);
        setFiles((current) => current.filter((_, i) => i !== index));
    }

    function startOver() {
        sessionRef.current = createShareUploadSession();
        setFiles([]);
        setSentBytes([]);
        setError(null);
        setLink(null);
        setPhase('selecting');
    }

    async function upload() {
        const controller = new AbortController();
        abortRef.current = controller;
        setError(null);
        setPhase('uploading');
        try {
            const result = await runShareUpload(
                files,
                sessionRef.current,
                {
                    create: createShare.mutateAsync,
                    complete: completeShare.mutateAsync,
                    put: xhrPut,
                },
                {
                    signal: controller.signal,
                    onProgress: (index, loaded) =>
                        setSentBytes((current) => {
                            const next = current.slice();
                            next[index] = loaded;
                            return next;
                        }),
                }
            );
            setLink(result);
            setPhase('done');
        } catch (cause) {
            setError(
                isAbortError(cause)
                    ? 'Upload cancelled'
                    : uploadErrorMessage(cause)
            );
            // No link yet means nothing is locked in: the user can still
            // change the selection the server refused.
            setPhase(sessionRef.current.link ? 'stopped' : 'selecting');
        }
    }

    if (phase === 'done' && link) {
        return (
            <ShareLinkCard
                link={link}
                fileCount={files.length}
                onStartOver={startOver}
            />
        );
    }

    const isSelecting = phase === 'selecting';
    const uploadedBytes = files.reduce(
        (sum, file, index) => sum + Math.min(sentBytes[index] ?? 0, file.size),
        0
    );

    return (
        <div className="space-y-4">
            {isSelecting && <DropZone onFiles={addFiles} />}

            {files.length > 0 && (
                <Card>
                    <CardContent className="space-y-4">
                        <div className="flex items-baseline justify-between gap-4 text-sm">
                            <span className="font-medium">
                                {countLabel(files.length, 'file')}
                            </span>
                            <span className="text-muted-foreground">
                                {formatBytes(selectedBytes)} of{' '}
                                {formatBytes(MAX_SHARE_BYTES)}
                            </span>
                        </div>

                        {!isSelecting && (
                            <Progress
                                aria-label="Upload progress"
                                value={
                                    selectedBytes === 0
                                        ? 0
                                        : (uploadedBytes / selectedBytes) * 100
                                }
                                className="h-1.5"
                            />
                        )}

                        <ul className="max-h-72 space-y-1 overflow-y-auto">
                            {files.map((file, index) => (
                                <SelectedFileRow
                                    key={`${index}-${file.name}`}
                                    file={file}
                                    isSent={
                                        !isSelecting &&
                                        (sentBytes[index] ?? 0) >= file.size
                                    }
                                    onRemove={
                                        isSelecting
                                            ? () => removeFile(index)
                                            : undefined
                                    }
                                />
                            ))}
                        </ul>

                        {(error ?? (isSelecting && selectionProblem)) && (
                            <p
                                role="alert"
                                className="flex items-center gap-2 text-sm text-destructive"
                            >
                                <AlertCircle className="size-4 shrink-0" />
                                {error ??
                                    (selectionProblem &&
                                        selectionProblemMessage(
                                            selectionProblem
                                        ))}
                            </p>
                        )}

                        <UploadActions
                            phase={phase}
                            canUpload={!selectionProblem}
                            onUpload={upload}
                            onCancel={() => abortRef.current?.abort()}
                            onStartOver={startOver}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

interface UploadActionsProps {
    phase: Phase;
    canUpload: boolean;
    onUpload: () => void;
    onCancel: () => void;
    onStartOver: () => void;
}

function UploadActions({
    phase,
    canUpload,
    onUpload,
    onCancel,
    onStartOver,
}: UploadActionsProps) {
    if (phase === 'uploading') {
        return (
            <Button variant="outline" className="w-full" onClick={onCancel}>
                Cancel
            </Button>
        );
    }
    if (phase === 'stopped') {
        return (
            <div className="flex gap-2">
                <Button
                    variant="outline"
                    className="flex-1"
                    onClick={onStartOver}
                >
                    Start over
                </Button>
                <Button className="flex-1" onClick={onUpload}>
                    Resume upload
                </Button>
            </div>
        );
    }
    return (
        <Button className="w-full" disabled={!canUpload} onClick={onUpload}>
            <Link2 />
            Get a link
        </Button>
    );
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
    const [isDragOver, setIsDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    function handleDrop(event: React.DragEvent) {
        event.preventDefault();
        setIsDragOver(false);
        // Read synchronously inside: the DataTransfer's items are only live
        // during the event. A dropped folder is walked for its files.
        void pickedFilesFromDataTransfer(event.dataTransfer).then((batch) =>
            onFiles(batch.files.map((picked) => picked.file))
        );
    }

    return (
        <Card
            className={cn(
                'border-2 border-dashed transition-colors',
                isDragOver ? 'border-primary bg-primary/5' : 'border-border'
            )}
        >
            <CardContent className="p-0">
                <div
                    onDrop={handleDrop}
                    onDragOver={(event) => {
                        event.preventDefault();
                        setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    className="flex flex-col items-center justify-center px-6 py-12"
                >
                    <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10">
                        <Upload className="size-7 text-primary" />
                    </div>
                    <h2 className="mb-1 text-lg font-semibold">
                        Drop files here
                    </h2>
                    <p className="mb-4 text-sm text-muted-foreground">
                        or pick them from your device
                    </p>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        className="hidden"
                        data-testid="share-file-input"
                        onChange={(event) => {
                            onFiles(Array.from(event.target.files ?? []));
                            // So picking the same file again still fires.
                            event.target.value = '';
                        }}
                    />
                    <Button
                        variant="outline"
                        onClick={() => inputRef.current?.click()}
                    >
                        Choose files
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

interface SelectedFileRowProps {
    file: File;
    isSent: boolean;
    /** Absent once the selection is locked to a link. */
    onRemove?: () => void;
}

function SelectedFileRow({ file, isSent, onRemove }: SelectedFileRowProps) {
    return (
        <li className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
            {isSent ? (
                <CheckCircle className="size-4 shrink-0 text-primary" />
            ) : (
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <MiddleTruncateName name={file.name} className="min-w-0 flex-1" />
            <span className="shrink-0 text-muted-foreground">
                {formatBytes(file.size)}
            </span>
            {onRemove && (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${file.name}`}
                    onClick={onRemove}
                >
                    <X />
                </Button>
            )}
        </li>
    );
}

interface ShareLinkCardProps {
    link: ShareLink;
    fileCount: number;
    onStartOver: () => void;
}

function ShareLinkCard({ link, fileCount, onStartOver }: ShareLinkCardProps) {
    // Only rendered after an upload in this tab, so `window` is always there.
    const url = `${window.location.origin}/s/${link.id}`;

    async function copy() {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('Link copied');
        } catch {
            toast.error('Couldn’t copy. Select the link and copy it by hand');
        }
    }

    return (
        <Card>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <CheckCircle className="size-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="font-semibold">Your link is ready</h2>
                        <p className="text-sm text-muted-foreground">
                            {countLabel(fileCount, 'file')} · works until{' '}
                            {format(link.expiresAt, "MMM d 'at' h:mm a")}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Input
                        readOnly
                        value={url}
                        aria-label="Share link"
                        className="min-w-0 font-mono text-sm"
                        onFocus={(event) => event.target.select()}
                    />
                    <Button onClick={copy}>
                        <Copy />
                        Copy
                    </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                    Anyone with this link can download the files.
                </p>
                <Button
                    variant="outline"
                    className="w-full"
                    onClick={onStartOver}
                >
                    Share more files
                </Button>
            </CardContent>
        </Card>
    );
}

'use client';

import { useState } from 'react';
import { Loader2, RotateCw, Trash2, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { RetrieveDialog } from '@/components/dashboard/RetrieveDialog';
import { DeleteDialog } from '@/components/dashboard/DeleteDialog';
import { toastRetrievalRequested } from '@/components/dashboard/file-browser/retrievalFeedback';
import { deriveStatus } from '@/components/dashboard/file-browser/status';
import { useTRPC } from '@/lib/trpc/client';
import { formatCount } from '@/lib/format';
import { toastContext } from '@/lib/trpc/error-link';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import {
    BatchRetrieveDialog,
    useBatchDelete,
    useBatchRestore,
} from './BatchPane';
import type { BatchView } from './batchSummary';
import type { LibraryFile } from '@nexus/db/repo/library';

interface SelectionBarProps {
    batch: BatchView;
    /** The whole batch, loaded or not: its actions run by batch id. */
    isWholeBatch: boolean;
    /** Otherwise the loaded files picked. */
    selectedFiles: LibraryFile[];
    onClear: () => void;
    /** The whole batch was deleted: there's nothing left to show. */
    onBatchDeleted: () => void;
}

/** The file browser's floating bulk-action bar, scoped to the open batch. */
export function SelectionBar(props: SelectionBarProps) {
    return (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
                {props.isWholeBatch ? (
                    <WholeBatchActions {...props} />
                ) : (
                    <FileActions {...props} />
                )}
                <span className="h-4 w-px bg-border" />
                <Button variant="ghost" size="icon-sm" onClick={props.onClear}>
                    <X className="size-3.5" />
                    <span className="sr-only">Clear selection</span>
                </Button>
            </div>
        </div>
    );
}

// "All 9,000 selected": restore and delete go to the server by batch id
// (#455), so the files the browser never paged in are part of it too.
function WholeBatchActions({
    batch,
    onClear,
    onBatchDeleted,
}: SelectionBarProps) {
    const [isRetrieveOpen, setIsRetrieveOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    // Cleared once the restore is in, like the per-file actions: a failed
    // one keeps the selection to try again with.
    const restore = useBatchRestore(batch, onClear);
    const remove = useBatchDelete(batch, onBatchDeleted);
    return (
        <>
            <span className="text-sm font-medium tabular-nums">
                All {formatCount(batch.fileCount)} selected
            </span>
            <span className="h-4 w-px bg-border" />
            <ActionButton
                icon={RotateCw}
                isPending={restore.isPending}
                disabled={batch.archivedCount === 0}
                onClick={() => setIsRetrieveOpen(true)}
            >
                Retrieve
            </ActionButton>
            <BatchRetrieveDialog
                batch={batch}
                open={isRetrieveOpen}
                onOpenChange={setIsRetrieveOpen}
                onConfirm={restore.restore}
            />
            <ActionButton
                icon={Trash2}
                isPending={remove.isPending}
                isDestructive
                onClick={() => setIsDeleteOpen(true)}
            >
                Delete
            </ActionButton>
            <DeleteDialog
                open={isDeleteOpen}
                onOpenChange={setIsDeleteOpen}
                fileCount={batch.fileCount}
                onConfirm={remove.remove}
            />
        </>
    );
}

function FileActions({ selectedFiles, onClear }: SelectionBarProps) {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const [isRetrieveOpen, setIsRetrieveOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const retrievable = selectedFiles.filter(
        (f) => deriveStatus(f) === 'archived'
    );

    const deleteMutation = useMutation(
        trpc.files.deleteMany.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to delete files' }),
            onSuccess() {
                invalidateFileList();
                onClear();
            },
        })
    );
    const retrievalMutation = useMutation(
        trpc.files.requestBulkRetrieval.mutationOptions({
            trpc: toastContext({
                errorMessage: 'Failed to request retrievals',
            }),
            onSuccess(result) {
                invalidateFileList();
                onClear();
                toastRetrievalRequested(result.fileCount);
            },
        })
    );

    return (
        <>
            <span className="text-sm font-medium tabular-nums">
                {formatCount(selectedFiles.length)} selected
            </span>
            <span className="h-4 w-px bg-border" />
            <ActionButton
                icon={RotateCw}
                isPending={retrievalMutation.isPending}
                disabled={retrievable.length === 0}
                onClick={() => setIsRetrieveOpen(true)}
            >
                Retrieve
            </ActionButton>
            <RetrieveDialog
                open={isRetrieveOpen}
                onOpenChange={setIsRetrieveOpen}
                files={retrievable}
                fileCount={retrievable.length}
                onConfirm={() =>
                    retrievalMutation.mutate({
                        fileIds: retrievable.map((f) => f.id),
                    })
                }
            />
            <ActionButton
                icon={Trash2}
                isPending={deleteMutation.isPending}
                isDestructive
                onClick={() => setIsDeleteOpen(true)}
            >
                Delete
            </ActionButton>
            <DeleteDialog
                open={isDeleteOpen}
                onOpenChange={setIsDeleteOpen}
                fileCount={selectedFiles.length}
                onConfirm={() =>
                    deleteMutation.mutate({
                        ids: selectedFiles.map((f) => f.id),
                    })
                }
            />
        </>
    );
}

function ActionButton({
    icon: Icon,
    isPending,
    disabled = false,
    isDestructive = false,
    onClick,
    children,
}: {
    icon: typeof RotateCw;
    isPending: boolean;
    disabled?: boolean;
    isDestructive?: boolean;
    onClick: () => void;
    children: string;
}) {
    return (
        <Button
            variant="ghost"
            size="sm"
            className={
                isDestructive
                    ? 'text-destructive hover:text-destructive'
                    : undefined
            }
            onClick={onClick}
            disabled={disabled || isPending}
        >
            {isPending ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
                <Icon className="mr-1.5 size-3.5" />
            )}
            {children}
        </Button>
    );
}

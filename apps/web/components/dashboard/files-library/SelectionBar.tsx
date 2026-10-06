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
import { toastContext } from '@/lib/trpc/error-link';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { formatCount } from './batchSummary';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

interface SelectionBarProps {
    selectedFiles: FileWithRetrieval[];
    onClear: () => void;
}

/** The file browser's floating bulk-action bar, scoped to the open batch. */
export function SelectionBar({ selectedFiles, onClear }: SelectionBarProps) {
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
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
                <span className="text-sm font-medium tabular-nums">
                    {formatCount(selectedFiles.length)} selected
                </span>
                <span className="h-4 w-px bg-border" />
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsRetrieveOpen(true)}
                    disabled={
                        retrievable.length === 0 || retrievalMutation.isPending
                    }
                >
                    {retrievalMutation.isPending ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                        <RotateCw className="mr-1.5 size-3.5" />
                    )}
                    Retrieve
                </Button>
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
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setIsDeleteOpen(true)}
                    disabled={deleteMutation.isPending}
                >
                    {deleteMutation.isPending ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                        <Trash2 className="mr-1.5 size-3.5" />
                    )}
                    Delete
                </Button>
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
                <span className="h-4 w-px bg-border" />
                <Button variant="ghost" size="icon-sm" onClick={onClear}>
                    <X className="size-3.5" />
                    <span className="sr-only">Clear selection</span>
                </Button>
            </div>
        </div>
    );
}

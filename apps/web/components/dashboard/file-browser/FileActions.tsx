'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPositioner,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Clock,
    Download,
    Loader2,
    MoreHorizontal,
    RotateCw,
    Trash2,
} from 'lucide-react';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { RetrieveDialog } from '@/components/dashboard/RetrieveDialog';
import type { FileWithRetrieval } from '@nexus/db/repo/files';
import type { DerivedStatus } from './status';

export function useFileActions(file: FileWithRetrieval) {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const invalidateFileList = useInvalidateFileList();

    const deleteMutation = useMutation(
        trpc.files.delete.mutationOptions({
            onSuccess: invalidateFileList,
        })
    );

    const retrievalMutation = useMutation(
        trpc.files.requestRetrieval.mutationOptions({
            onSuccess() {
                invalidateFileList();
                toast.success('Retrieval request submitted');
            },
        })
    );

    async function handleDownload() {
        try {
            const { url } = await queryClient.fetchQuery(
                trpc.files.getDownloadUrl.queryOptions({ fileId: file.id })
            );
            window.open(url, '_blank');
        } catch {
            toast.error('Failed to get download URL');
        }
    }

    return {
        onDelete: () => deleteMutation.mutate({ id: file.id }),
        onRetrieval: () => retrievalMutation.mutate({ fileId: file.id }),
        onDownload: handleDownload,
        isDeleting: deleteMutation.isPending,
        isRetrieving: retrievalMutation.isPending,
    };
}

interface FileActionsProps {
    status: DerivedStatus;
    storageTier: FileWithRetrieval['storageTier'];
    onDelete: () => void;
    onRetrieval: () => void;
    onDownload: () => void;
    isDeleting: boolean;
    isRetrieving: boolean;
}

export function FileActions({
    status,
    storageTier,
    onDelete,
    onRetrieval,
    onDownload,
    isDeleting,
    isRetrieving,
}: FileActionsProps) {
    // The dialog lives outside the dropdown: menu content unmounts on close,
    // which would tear the dialog down mid-open.
    const [isRetrieveDialogOpen, setIsRetrieveDialogOpen] = useState(false);
    return (
        <>
            <RetrieveDialog
                open={isRetrieveDialogOpen}
                onOpenChange={setIsRetrieveDialogOpen}
                tiers={[storageTier]}
                fileCount={1}
                onConfirm={onRetrieval}
            />
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-sm" />}
                >
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">Actions</span>
                </DropdownMenuTrigger>
                <DropdownMenuPositioner align="end">
                    <DropdownMenuContent>
                        {status === 'archived' && (
                            <DropdownMenuItem
                                onClick={() => setIsRetrieveDialogOpen(true)}
                                disabled={isRetrieving}
                            >
                                {isRetrieving ? (
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                ) : (
                                    <Clock className="mr-2 size-4" />
                                )}
                                Request retrieval
                            </DropdownMenuItem>
                        )}
                        {status === 'available' && (
                            <DropdownMenuItem onClick={onDownload}>
                                <Download className="mr-2 size-4" />
                                Download
                            </DropdownMenuItem>
                        )}
                        {status === 'retrieving' && (
                            <DropdownMenuItem disabled>
                                <RotateCw className="mr-2 size-4" />
                                Retrieving...
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={onDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                            ) : (
                                <Trash2 className="mr-2 size-4" />
                            )}
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenuPositioner>
            </DropdownMenu>
        </>
    );
}

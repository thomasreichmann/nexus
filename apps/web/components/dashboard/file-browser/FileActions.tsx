'use client';

import { useState } from 'react';
import {
    Clock,
    Download,
    Loader2,
    MoreHorizontal,
    RotateCw,
    Trash2,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isProbablyCold } from '@nexus/db/objectState';
import { useTRPC } from '@/lib/trpc/client';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPositioner,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { captureEvent } from '@/lib/posthog/client';
import { PostHogEvent } from '@/lib/posthog/events';
import { RetrieveDialog } from '@/components/dashboard/RetrieveDialog';
import { DeleteDialog } from '@/components/dashboard/DeleteDialog';
import { toastContext } from '@/lib/trpc/error-link';
import type { RetrievableFile } from '@/components/dashboard/RetrieveDialog';
import { toastRetrievalRequested } from './retrievalFeedback';
import type { FileWithRetrieval } from '@nexus/db/repo/files';
import type { DerivedStatus } from './status';

export function useFileActions(file: FileWithRetrieval) {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const invalidateFileList = useInvalidateFileList();

    const deleteMutation = useMutation(
        trpc.files.delete.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to delete file' }),
            onSuccess: invalidateFileList,
        })
    );

    const retrievalMutation = useMutation(
        trpc.files.requestRetrieval.mutationOptions({
            trpc: toastContext({
                errorMessage: 'Failed to request retrieval',
            }),
            // No `retrieval_requested` capture here: the request path emits it
            // server-side, where it fires exactly once per committed request
            // (#426). Two emitters of one event name double every funnel step.
            onSuccess(result) {
                invalidateFileList();
                toastRetrievalRequested(result.fileCount);
            },
        })
    );

    async function handleDownload() {
        try {
            const { url } = await queryClient.fetchQuery(
                trpc.files.getDownloadUrl.queryOptions({ fileId: file.id })
            );
            captureEvent(PostHogEvent.FileDownloaded, {
                fileId: file.id,
                sizeBytes: file.size,
                isProbablyCold: isProbablyCold(file),
            });
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

/**
 * What the menu's dialogs need from a file: the retrieve estimate's inputs
 * plus a name for the delete confirmation. Every caller passes a full
 * `FileWithRetrieval`.
 */
interface ActionableFile extends RetrievableFile {
    name: string;
}

interface FileActionsProps {
    status: DerivedStatus;
    file: ActionableFile;
    onDelete: () => void;
    onRetrieval: () => void;
    onDownload: () => void;
    isDeleting: boolean;
    isRetrieving: boolean;
}

export function FileActions({
    status,
    file,
    onDelete,
    onRetrieval,
    onDownload,
    isDeleting,
    isRetrieving,
}: FileActionsProps) {
    // The dialogs live outside the dropdown: menu content unmounts on close,
    // which would tear a dialog down mid-open.
    const [isRetrieveDialogOpen, setIsRetrieveDialogOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    return (
        <>
            <RetrieveDialog
                open={isRetrieveDialogOpen}
                onOpenChange={setIsRetrieveDialogOpen}
                files={[file]}
                fileCount={1}
                onConfirm={onRetrieval}
            />
            <DeleteDialog
                open={isDeleteDialogOpen}
                onOpenChange={setIsDeleteDialogOpen}
                fileCount={1}
                fileName={file.name}
                onConfirm={onDelete}
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
                            onClick={() => setIsDeleteDialogOpen(true)}
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

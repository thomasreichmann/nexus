'use client';

import {
    Clock,
    Download,
    Loader2,
    MoreHorizontal,
    RotateCw,
    Trash2,
} from 'lucide-react';
import {
    useMutation,
    useMutationState,
    useQueryClient,
} from '@tanstack/react-query';
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
import type { DerivedStatus } from './status';

/**
 * What a file's actions need from it: an id, the retrieve estimate's inputs,
 * and a name for the delete confirmation.
 */
export interface ActionableFile extends RetrievableFile {
    id: string;
    name: string;
}

export type FileAction = 'retrieve' | 'download' | 'delete';

export interface FileActionHandlers {
    remove: (fileId: string) => void;
    retrieve: (fileId: string) => void;
    download: (file: ActionableFile) => Promise<void>;
}

interface UseFileActionsOptions {
    /** Runs for each file once its delete is in. */
    onDeleted: (fileId: string) => void;
}

/**
 * The library's per-file delete, retrieve and download: one delete and one
 * retrieval mutation shared by every tile, row and the viewer, rather than a
 * pair per file (#477).
 */
export function useFileActions({
    onDeleted,
}: UseFileActionsOptions): FileActionHandlers {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const invalidateFileList = useInvalidateFileList();

    const deleteMutation = useMutation(
        trpc.files.delete.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to delete file' }),
            // Pending until the list has refetched without the file, so its
            // tile never shows an idle Delete in between.
            onSuccess(_file, { id }) {
                onDeleted(id);
                return invalidateFileList();
            },
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

    async function download(file: ActionableFile) {
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
        remove: (fileId) => deleteMutation.mutate({ id: fileId }),
        retrieve: (fileId) => retrievalMutation.mutate({ fileId }),
        download,
    };
}

/**
 * A delete or retrieval of this file on its way, asked for from its menu or
 * the viewer. Read from the mutation cache, not a mutation's own `isPending`:
 * the library's one mutation of each would speak for whichever file went
 * last. The cache gives the ids in flight and the file is looked up here,
 * because a cache filter only re-runs on a cache event: the viewer, browsing
 * on to the next file, would still be reading the last one's.
 */
export function useFilePending(fileId: string): {
    isDeleting: boolean;
    isRetrieving: boolean;
} {
    const trpc = useTRPC();
    const deletingIds = useMutationState({
        filters: {
            mutationKey: trpc.files.delete.mutationKey(),
            status: 'pending',
        },
        select: (m) => readVariable(m.state.variables, 'id'),
    });
    const retrievingIds = useMutationState({
        filters: {
            mutationKey: trpc.files.requestRetrieval.mutationKey(),
            status: 'pending',
        },
        select: (m) => readVariable(m.state.variables, 'fileId'),
    });
    return {
        isDeleting: deletingIds.includes(fileId),
        isRetrieving: retrievingIds.includes(fileId),
    };
}

function readVariable(variables: unknown, key: string): unknown {
    return (variables as Record<string, unknown> | undefined)?.[key];
}

/** A file menu's retrieve or delete, waiting on its confirm. */
export interface FileConfirm {
    action: 'retrieve' | 'delete';
    file: ActionableFile;
    /**
     * Off once it's answered, while the rest stays: the dialog keeps naming
     * its file as it animates closed.
     */
    isOpen: boolean;
}

interface FileConfirmDialogsProps {
    confirm: FileConfirm | null;
    onOpenChange: (isOpen: boolean) => void;
    actions: FileActionHandlers;
}

/**
 * The confirm step of every file menu in the pane: one retrieve and one
 * delete dialog, aimed at whichever file's menu asked (#477), rather than a
 * pair mounted under each tile and row.
 */
export function FileConfirmDialogs({
    confirm,
    onOpenChange,
    actions,
}: FileConfirmDialogsProps) {
    if (!confirm) return null;
    const { action, file, isOpen } = confirm;
    return (
        <>
            <RetrieveDialog
                open={isOpen && action === 'retrieve'}
                onOpenChange={onOpenChange}
                files={[file]}
                fileCount={1}
                onConfirm={() => actions.retrieve(file.id)}
            />
            <DeleteDialog
                open={isOpen && action === 'delete'}
                onOpenChange={onOpenChange}
                fileCount={1}
                fileName={file.name}
                onConfirm={() => actions.remove(file.id)}
            />
        </>
    );
}

interface FileActionsProps {
    status: DerivedStatus;
    file: ActionableFile;
    /** Download runs at once; retrieve and delete go through a confirm. */
    onAction: (action: FileAction, file: ActionableFile) => void;
}

export function FileActions({ status, file, onAction }: FileActionsProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" />}
            >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuPositioner align="end">
                <DropdownMenuContent>
                    <FileMenuItems
                        status={status}
                        fileId={file.id}
                        onAction={(action) => onAction(action, file)}
                    />
                </DropdownMenuContent>
            </DropdownMenuPositioner>
        </DropdownMenu>
    );
}

interface FileMenuItemsProps {
    status: DerivedStatus;
    fileId: string;
    onAction: (action: FileAction) => void;
}

// Mounted only while the menu is open, so a pane of tiles doesn't keep a
// watch on the mutation cache per file.
function FileMenuItems({ status, fileId, onAction }: FileMenuItemsProps) {
    const { isDeleting, isRetrieving } = useFilePending(fileId);
    return (
        <>
            {status === 'archived' && (
                <DropdownMenuItem
                    onClick={() => onAction('retrieve')}
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
                <DropdownMenuItem onClick={() => onAction('download')}>
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
                onClick={() => onAction('delete')}
                disabled={isDeleting}
            >
                {isDeleting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                    <Trash2 className="mr-2 size-4" />
                )}
                Delete
            </DropdownMenuItem>
        </>
    );
}

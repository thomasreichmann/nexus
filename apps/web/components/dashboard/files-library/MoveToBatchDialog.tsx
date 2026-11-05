'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { countLabel } from '@/lib/format';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { BatchPicker } from './BatchPicker';
import type { BatchView } from './batchSummary';

const COPY = {
    move: { title: 'Move to batch', submit: 'Move', pending: 'Moving…' },
    merge: { title: 'Merge into batch', submit: 'Merge', pending: 'Merging…' },
};

interface MoveToBatchDialogProps {
    /** Where the files are now: never offered as the target. */
    source: Pick<BatchView, 'batchId' | 'name'>;
    /** The files to move. Without them, the whole source batch merges. */
    fileIds?: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * With the batch the files went to, once the server has them there: a
     * move's after the library has refetched, a merge's before (it opens
     * the target, as the emptied source is about to close).
     */
    onMoved?: (targetBatchId: string) => void;
}

/**
 * Move files into another of the user's batches, or merge a whole batch into
 * one (#453). A dialog rather than a submenu: the batches page in as they're
 * searched, and `components/ui` has no combobox. Never into Ungrouped: a
 * move only points the files at another batch row, and Ungrouped has none.
 */
export function MoveToBatchDialog({
    source,
    fileIds,
    open,
    onOpenChange,
    onMoved,
}: MoveToBatchDialogProps) {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const searchRef = useRef<HTMLInputElement>(null);
    const [targetId, setTargetId] = useState<string | null>(null);
    // Each open starts from scratch, not from the last one's pick.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setTargetId(null);
    }

    const isMerge = fileIds === undefined;
    const moveFiles = useMutation(
        trpc.files.moveFiles.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to move files' }),
            // Held until the pane has refetched, so the dialog closes onto
            // the files gone rather than onto them for a round trip.
            async onSuccess(_result, { targetBatchId }) {
                await invalidateFileList();
                onOpenChange(false);
                onMoved?.(targetBatchId);
            },
        })
    );
    const mergeBatch = useMutation(
        trpc.files.mergeBatch.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to merge batch' }),
            // Onto the target before the refetch: it empties the source, and
            // the pane would close under the dialog.
            onSuccess(_result, { targetBatchId }) {
                onOpenChange(false);
                onMoved?.(targetBatchId);
                return invalidateFileList();
            },
        })
    );
    const isPending = moveFiles.isPending || mergeBatch.isPending;
    const canSubmit = targetId !== null && !isPending;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        if (isMerge) {
            mergeBatch.mutate({
                sourceBatchId: source.batchId,
                targetBatchId: targetId,
            });
        } else {
            moveFiles.mutate({ fileIds, targetBatchId: targetId });
        }
    };

    // Open until the move settles: closed mid-flight, a failure would toast
    // over nothing.
    const changeOpen = (next: boolean) => {
        if (!next && isPending) return;
        onOpenChange(next);
    };

    const copy = COPY[isMerge ? 'merge' : 'move'];
    const description = isMerge
        ? `Every file in ${source.name} moves to the batch you pick, and ${source.name} leaves your library.`
        : `${countLabel(fileIds.length, 'file')} from ${source.name} move to the batch you pick.`;

    return (
        <AlertDialog open={open} onOpenChange={changeOpen}>
            <AlertDialogPopup initialFocus={searchRef}>
                <form onSubmit={submit} className="grid min-w-0 gap-4">
                    <div className="grid gap-1.5">
                        <AlertDialogTitle>{copy.title}</AlertDialogTitle>
                        <AlertDialogDescription className="wrap-break-word">
                            {description}
                        </AlertDialogDescription>
                    </div>
                    <BatchPicker
                        excludeBatchId={source.batchId}
                        pickedId={targetId}
                        onPick={(batch) => setTargetId(batch.batchId)}
                        searchRef={searchRef}
                    />
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>
                            Cancel
                        </AlertDialogCancel>
                        <Button type="submit" disabled={!canSubmit}>
                            {isPending ? copy.pending : copy.submit}
                        </Button>
                    </AlertDialogFooter>
                </form>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

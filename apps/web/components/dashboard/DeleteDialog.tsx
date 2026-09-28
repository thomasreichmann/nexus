'use client';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DialogFileName } from './DialogFileName';

interface DeleteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileCount: number;
    /** Set when a single row is targeted — the dialog then names it. */
    fileName?: string;
    onConfirm: () => void;
}

/**
 * Confirmation dialog for every delete trigger (bulk selection, single row
 * menu), so both paths share one copy (#403). The row menu's Delete sits one
 * pixel under the only other action on an archived row, and a deleted file
 * has no way back from the UI — so that click gets a second step too.
 * Controlled by the caller, mirroring `RetrieveDialog`.
 *
 * Both buttons name their outcome ("Keep …" / "Delete …"), as in
 * `CancelUploadDialog`, so neither reads as a generic Cancel/OK.
 *
 * Copy is scoped to today's soft delete: rows leave the vault and their
 * storage is released, but nothing is physically erased yet. Revisit once
 * the reaper (#307) removes objects for real.
 */
export function DeleteDialog({
    open,
    onOpenChange,
    fileCount,
    fileName,
    onConfirm,
}: DeleteDialogProps) {
    const isPlural = fileCount > 1;
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup>
                <AlertDialogTitle>
                    {fileName
                        ? 'Delete this file?'
                        : `Delete ${fileCount} file${isPlural ? 's' : ''}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                    {isPlural ? 'They’ll' : 'It’ll'} be removed from your vault
                    and no longer count toward your storage. There’s no undo, so
                    keep a copy of anything you still need.
                </AlertDialogDescription>
                {fileName && <DialogFileName name={fileName} />}
                <AlertDialogFooter>
                    <AlertDialogCancel>
                        {isPlural ? 'Keep files' : 'Keep file'}
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>
                        {isPlural ? `Delete ${fileCount} files` : 'Delete file'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

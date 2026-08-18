'use client';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MiddleTruncateName } from './MiddleTruncateName';

interface CancelUploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Name of the upload being cancelled; null while no row is targeted. */
    fileName: string | null;
    onConfirm: () => void;
}

/**
 * Confirmation guard for the destructive per-row Cancel (#389). Unlike the
 * Remove X on a pending row, cancelling an in-flight or resumable upload
 * aborts the S3 session and deletes the resume record — a misclick deep into
 * a large upload is unrecoverable, so this one click gets a second step.
 * Controlled by the caller, mirroring `RetrieveDialog`.
 */
export function CancelUploadDialog({
    open,
    onOpenChange,
    fileName,
    onConfirm,
}: CancelUploadDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup>
                <AlertDialogTitle>Cancel this upload?</AlertDialogTitle>
                <AlertDialogDescription>
                    Its progress will be thrown away — a cancelled upload can’t
                    be resumed.
                </AlertDialogDescription>
                {fileName && (
                    <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm">
                        <MiddleTruncateName
                            name={fileName}
                            className="font-medium"
                        />
                    </div>
                )}
                <div className="flex justify-end gap-2">
                    <AlertDialogCancel>Keep upload</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>
                        Cancel upload
                    </AlertDialogAction>
                </div>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

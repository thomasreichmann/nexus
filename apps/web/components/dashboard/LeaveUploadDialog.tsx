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

interface LeaveUploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Navigate to the intercepted destination, abandoning the wave. */
    onConfirm: () => void;
}

/**
 * Confirmation for the in-app navigation guard (#398): leaving the upload
 * page mid-wave unmounts the engine and kills every in-flight upload. Button
 * labels are deliberately distinct from CancelUploadDialog's — both dialogs
 * live on the same page, and "Cancel upload" locators must stay unambiguous.
 */
export function LeaveUploadDialog({
    open,
    onOpenChange,
    onConfirm,
}: LeaveUploadDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup>
                <AlertDialogTitle>Leave this page?</AlertDialogTitle>
                <AlertDialogDescription>
                    Files are still uploading. If you leave now, the uploads in
                    progress will stop and any unfinished files will not be
                    saved.
                </AlertDialogDescription>
                <AlertDialogFooter>
                    <AlertDialogCancel>Stay</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>
                        Leave anyway
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

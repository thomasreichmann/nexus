'use client';

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { MAX_FILES_PER_DROP } from '@/lib/upload/limits';

interface CappedSelectionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Queue the files the walk kept before it stopped. */
    onConfirm: () => void;
}

/**
 * Blocking choice for a gesture that hit `MAX_FILES_PER_DROP` (#402). The
 * walk stops at the cap, so the total is unknown and the files past it were
 * never read — the honest offer is the kept prefix or nothing, said out loud
 * instead of the transient toast that used to trim silently. Controlled by
 * the caller, mirroring `CancelUploadDialog`.
 *
 * The confirm is a plain `Button` rather than `AlertDialogAction`: the latter
 * also requests a close, and the caller reads `onOpenChange(false)` as a
 * dismissal, so accepting would count twice.
 */
export function CappedSelectionDialog({
    open,
    onOpenChange,
    onConfirm,
}: CappedSelectionDialogProps) {
    const cap = MAX_FILES_PER_DROP.toLocaleString();
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup>
                <AlertDialogTitle>
                    This selection has more than {cap} files
                </AlertDialogTitle>
                <AlertDialogDescription>
                    Nexus stops reading a selection at {cap} files, so
                    everything past that point was left out. To upload all of
                    it, add it in smaller batches — one subfolder at a time.
                </AlertDialogDescription>
                {/* Two long labels don't fit a phone-width popup side by
                    side, and buttons never wrap internally. */}
                <AlertDialogFooter className="flex-wrap">
                    <AlertDialogCancel>Don’t add anything</AlertDialogCancel>
                    <Button onClick={onConfirm}>Add the first {cap}</Button>
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

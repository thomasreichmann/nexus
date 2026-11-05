'use client';

import { useRef, useState } from 'react';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { BatchPicker, type TargetBatch } from './files-library/BatchPicker';

interface ChooseBatchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChoose: (batch: TargetBatch) => void;
}

/**
 * Picks one of the user's batches for an upload to join (#454): the rest of
 * a half-uploaded shoot goes back in with its first half rather than into a
 * second batch of the same name. Only picks; the Upload click sends.
 */
export function ChooseBatchDialog({
    open,
    onOpenChange,
    onChoose,
}: ChooseBatchDialogProps) {
    const searchRef = useRef<HTMLInputElement>(null);
    const [picked, setPicked] = useState<TargetBatch | null>(null);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setPicked(null);
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup initialFocus={searchRef}>
                <div className="grid min-w-0 gap-4">
                    <div className="grid gap-1.5">
                        <AlertDialogTitle>Add to a batch</AlertDialogTitle>
                        <AlertDialogDescription>
                            The files you upload join the batch you pick.
                        </AlertDialogDescription>
                    </div>
                    <BatchPicker
                        pickedId={picked?.batchId ?? null}
                        onPick={setPicked}
                        searchRef={searchRef}
                    />
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        {/* A plain button: AlertDialogAction also asks to
                            close, which the caller would read as a dismissal. */}
                        <Button
                            disabled={picked === null}
                            onClick={() => {
                                if (!picked) return;
                                onChoose(picked);
                                onOpenChange(false);
                            }}
                        >
                            Add to batch
                        </Button>
                    </AlertDialogFooter>
                </div>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

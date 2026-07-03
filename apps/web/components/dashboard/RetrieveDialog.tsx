'use client';

import { Clock, Zap } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DEFAULT_RESTORE_DAYS_TO_KEEP } from '@/lib/storage/types';
import type { StorageTier } from '@/lib/storage/types';

export interface RetrievalEstimate {
    speed: 'fast' | 'slow';
    label: string;
}

/**
 * Honest per-batch time estimate from the items' actual storage tiers:
 * all-standard batches complete in the fast path (#257), anything colder is
 * paced by its slowest item. Glacier folds into the slow bucket — "up to 12
 * hours" under-promises for its 3-5h restores rather than adding a third
 * estimate. An empty list is conservatively slow; callers gate on a
 * non-empty selection before opening the dialog.
 */
export function getRetrievalEstimate(tiers: StorageTier[]): RetrievalEstimate {
    const isAllStandard =
        tiers.length > 0 && tiers.every((tier) => tier === 'standard');
    return isAllStandard
        ? { speed: 'fast', label: 'Ready in ~minutes' }
        : { speed: 'slow', label: 'Ready in up to 12 hours' };
}

interface RetrieveDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Storage tiers of the items being retrieved; drives the estimate. */
    tiers: StorageTier[];
    fileCount: number;
    onConfirm: () => void;
}

/**
 * Confirmation dialog for every retrieve trigger (bulk selection, batch
 * header, single file). Controlled by the caller so it can also be opened
 * from inside a dropdown menu, which unmounts its items on close.
 */
export function RetrieveDialog({
    open,
    onOpenChange,
    tiers,
    fileCount,
    onConfirm,
}: RetrieveDialogProps) {
    const estimate = getRetrievalEstimate(tiers);
    const EstimateIcon = estimate.speed === 'fast' ? Zap : Clock;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogPopup>
                <AlertDialogTitle>
                    Retrieve {fileCount} file{fileCount !== 1 ? 's' : ''}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                    Files are copied out of deep storage into a temporary
                    download window.
                </AlertDialogDescription>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
                    <EstimateIcon
                        className={
                            estimate.speed === 'fast'
                                ? 'size-4 shrink-0 text-emerald-500'
                                : 'size-4 shrink-0 text-blue-500'
                        }
                    />
                    <div className="min-w-0 text-sm">
                        <p className="font-medium">{estimate.label}</p>
                        <p className="text-xs text-muted-foreground">
                            Downloadable for {DEFAULT_RESTORE_DAYS_TO_KEEP} days
                            once ready
                        </p>
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="default" onClick={onConfirm}>
                        Retrieve
                    </AlertDialogAction>
                </div>
            </AlertDialogPopup>
        </AlertDialog>
    );
}

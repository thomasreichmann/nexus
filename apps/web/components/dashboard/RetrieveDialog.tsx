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

export interface RetrievalEstimate {
    speed: 'fast' | 'slow';
    label: string;
}

/**
 * Per-batch time estimate, paced by the slowest item: a batch we expect to be
 * entirely warm completes in the fast path (#257), anything else is quoted at
 * the Deep Archive worst case.
 *
 * The input is a guess, not a fact — S3 owns object state, and the real
 * warm/cold answer is only known once the request reaches the server and HEADs
 * each object (#416). Erring slow is the honest direction: a batch that turns
 * out warm beats its estimate, and nobody is promised minutes for something
 * that takes hours. An empty list is conservatively slow; callers gate on a
 * non-empty selection before opening the dialog.
 */
export function getRetrievalEstimate(coldness: boolean[]): RetrievalEstimate {
    const isAllWarm =
        coldness.length > 0 && coldness.every((isCold) => !isCold);
    return isAllWarm
        ? { speed: 'fast', label: 'Ready in ~minutes' }
        : { speed: 'slow', label: 'Ready in up to 12 hours' };
}

interface RetrieveDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Per-item `isProbablyCold` hints for the selection; drives the estimate.
     * A policy expectation, not a claim — see `getRetrievalEstimate`.
     */
    coldness: boolean[];
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
    coldness,
    fileCount,
    onConfirm,
}: RetrieveDialogProps) {
    const estimate = getRetrievalEstimate(coldness);
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

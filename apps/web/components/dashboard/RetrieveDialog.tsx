'use client';

import { Clock, Zap } from 'lucide-react';
import { isProbablyCold } from '@nexus/db/objectState';
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

/** What the estimate needs from a file — `isProbablyCold`'s inputs, no more. */
export interface RetrievableFile {
    size: number;
    createdAt: Date;
}

/**
 * Per-batch time estimate, paced by the slowest item: a batch we expect to be
 * entirely warm completes in the fast path (#257), anything else is quoted at
 * the Deep Archive worst case.
 *
 * Takes the files and applies `isProbablyCold` itself rather than taking the
 * verdicts, so the policy is read in exactly one place — every call site used
 * to map the files through it on the way in, which is three chances to use a
 * different rule.
 *
 * The answer is a guess, not a fact — S3 owns object state, and the real
 * warm/cold split is only known once the request reaches the server and HEADs
 * each object (#416). Erring slow is the honest direction: a batch that turns
 * out warm beats its estimate, and nobody is promised minutes for something
 * that takes hours. An empty list is conservatively slow; callers gate on a
 * non-empty selection before opening the dialog.
 */
export function getRetrievalEstimate(
    files: RetrievableFile[]
): RetrievalEstimate {
    const isAllWarm = files.length > 0 && !files.some((f) => isProbablyCold(f));
    return isAllWarm
        ? { speed: 'fast', label: 'Ready in ~minutes' }
        : { speed: 'slow', label: 'Ready in up to 12 hours' };
}

interface RetrieveDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The files being retrieved; the estimate is derived from these. */
    files: RetrievableFile[];
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
    files,
    fileCount,
    onConfirm,
}: RetrieveDialogProps) {
    const estimate = getRetrievalEstimate(files);
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

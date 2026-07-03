'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { ChevronRight, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { RetrieveDialog } from '@/components/dashboard/RetrieveDialog';
import type { FileBatchGroup, FileWithRetrieval } from '@nexus/db/repo/files';
import { deriveStatus } from './status';

function formatBatchDate(date: Date | null): string | null {
    if (!date) return null;
    const d = new Date(date);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: sameYear ? undefined : 'numeric',
    });
}

interface BatchHeaderProps {
    group: FileBatchGroup;
    expanded: boolean;
    onToggle: () => void;
}

export function BatchHeader({ group, expanded, onToggle }: BatchHeaderProps) {
    const isUngrouped = group.batchId === null;
    const fileCount = group.files.length;
    const totalBytes = group.files.reduce((s, f) => s + (f.size ?? 0), 0);
    const dateLabel = formatBatchDate(group.batchCreatedAt);

    return (
        <div className="flex w-full items-center gap-2">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
            >
                <ChevronRight
                    className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                        expanded && 'rotate-90'
                    )}
                />
                <div className="min-w-0 flex-1">
                    <h3
                        className={cn(
                            'truncate font-semibold tracking-tight',
                            isUngrouped
                                ? 'text-muted-foreground'
                                : 'text-foreground'
                        )}
                    >
                        {isUngrouped ? 'Ungrouped' : group.batchName}
                    </h3>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {fileCount} {fileCount === 1 ? 'file' : 'files'}
                        {' · '}
                        {formatBytes(totalBytes)}
                        {dateLabel && ` · ${dateLabel}`}
                    </p>
                </div>
            </button>
            {!isUngrouped && group.batchId && (
                <BatchRestoreSlot batchId={group.batchId} files={group.files} />
            )}
        </div>
    );
}

export function BatchHeaderRow({
    group,
    expanded,
    onToggle,
    colSpan,
}: BatchHeaderProps & { colSpan: number }) {
    return (
        <TableRow className="border-b-0 hover:bg-transparent">
            <TableCell colSpan={colSpan} className="p-0">
                <BatchHeader
                    group={group}
                    expanded={expanded}
                    onToggle={onToggle}
                />
            </TableCell>
        </TableRow>
    );
}

interface BatchRestoreSlotProps {
    batchId: string;
    files: FileWithRetrieval[];
}

function BatchRestoreSlot({ batchId, files }: BatchRestoreSlotProps) {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const mutation = useMutation(
        trpc.files.requestBatchRetrieval.mutationOptions({
            onSuccess() {
                invalidateFileList();
                toast.success('Batch retrieval submitted');
            },
            onError(err) {
                toast.error(err.message || 'Failed to request batch retrieval');
            },
        })
    );

    const fileCount = files.length;
    const restoringCount = files.filter(
        (f) => deriveStatus(f) === 'retrieving'
    ).length;
    const eligibleFiles = files.filter((f) => deriveStatus(f) === 'archived');

    if (restoringCount === fileCount && fileCount > 0) {
        return (
            <span className="shrink-0 pr-2 text-xs tabular-nums text-muted-foreground">
                Restoring {restoringCount}/{fileCount}
            </span>
        );
    }
    if (restoringCount > 0) {
        return (
            <span className="flex shrink-0 items-center gap-1.5 pr-2 text-xs tabular-nums text-muted-foreground">
                <RotateCw className="h-3.5 w-3.5 animate-spin" />
                Restoring {restoringCount} of {fileCount}
            </span>
        );
    }
    if (eligibleFiles.length === 0) return null;

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDialogOpen(true)}
                disabled={mutation.isPending}
                className="shrink-0"
            >
                <RotateCw
                    className={cn(
                        'mr-1.5 h-3.5 w-3.5',
                        mutation.isPending && 'animate-spin'
                    )}
                />
                {mutation.isPending ? 'Requesting…' : 'Restore batch'}
            </Button>
            <RetrieveDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                tiers={eligibleFiles.map((f) => f.storageTier)}
                fileCount={eligibleFiles.length}
                onConfirm={() => mutation.mutate({ batchId, tier: 'standard' })}
            />
        </>
    );
}

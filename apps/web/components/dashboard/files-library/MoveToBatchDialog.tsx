'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import {
    keepPreviousData,
    useInfiniteQuery,
    useMutation,
} from '@tanstack/react-query';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countLabel } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { BATCH_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '@/lib/library/paging';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { formatBatchDate, toBatchView, type BatchView } from './batchSummary';

const COPY = {
    move: { title: 'Move to batch', submit: 'Move', pending: 'Moving…' },
    merge: { title: 'Merge into batch', submit: 'Merge', pending: 'Merging…' },
};

/** A batch a move can go into: a real batch row, so never Ungrouped. */
interface TargetBatch extends BatchView {
    batchId: string;
}

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
    const [search, setSearch] = useState('');
    const [targetId, setTargetId] = useState<string | null>(null);
    // Each open starts from scratch, not from the last one's search and pick.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setSearch('');
            setTargetId(null);
        }
    }

    const isMerge = fileIds === undefined;
    const activeSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
    // The library's own query when nothing is typed, so the first page is
    // usually in the cache already.
    const batchesQuery = useInfiniteQuery(
        trpc.files.listBatches.infiniteQueryOptions(
            { search: activeSearch || undefined, limit: BATCH_PAGE_SIZE },
            {
                enabled: open,
                getNextPageParam: (page) => page.nextCursor ?? undefined,
                placeholderData: keepPreviousData,
            }
        )
    );
    const targets =
        batchesQuery.data?.pages
            .flatMap((page) => page.batches.map(toBatchView))
            .filter(
                (batch): batch is TargetBatch =>
                    batch.batchId !== null && batch.batchId !== source.batchId
            ) ?? [];

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
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            ref={searchRef}
                            type="search"
                            placeholder="Search batches"
                            aria-label="Search batches"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <TargetList
                        targets={targets}
                        targetId={targetId}
                        onPick={setTargetId}
                        isLoading={batchesQuery.isPending}
                        isSearching={activeSearch !== ''}
                        hasMore={batchesQuery.hasNextPage}
                        isLoadingMore={batchesQuery.isFetchingNextPage}
                        onShowMore={() => void batchesQuery.fetchNextPage()}
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

interface TargetListProps {
    targets: TargetBatch[];
    targetId: string | null;
    onPick: (batchId: string) => void;
    isLoading: boolean;
    isSearching: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    onShowMore: () => void;
}

function TargetList({
    targets,
    targetId,
    onPick,
    isLoading,
    isSearching,
    hasMore,
    isLoadingMore,
    onShowMore,
}: TargetListProps) {
    const groupName = useId();
    if (isLoading) {
        return (
            <div className="flex h-24 items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
        );
    }
    // A short page can still have more behind it: the source and Ungrouped
    // are dropped here, not by the server.
    if (targets.length === 0 && !hasMore) {
        return (
            <p className="py-8 text-center text-sm text-muted-foreground">
                {isSearching ? 'No batches match' : 'No other batches yet'}
            </p>
        );
    }
    return (
        <div
            role="radiogroup"
            aria-label="Target batch"
            className="-mx-1 max-h-72 overflow-y-auto px-1"
        >
            <div className="grid gap-1">
                {targets.map((batch) => (
                    <label
                        key={batch.key}
                        className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2 hover:bg-muted has-[:checked]:border-border has-[:checked]:bg-muted"
                    >
                        <input
                            type="radio"
                            name={groupName}
                            value={batch.key}
                            checked={batch.batchId === targetId}
                            onChange={() => onPick(batch.batchId)}
                            className="accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                                {batch.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground tabular-nums">
                                {[
                                    countLabel(batch.fileCount, 'file'),
                                    formatBatchDate(batch.createdAt),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        </span>
                    </label>
                ))}
            </div>
            {hasMore && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 w-full"
                    onClick={onShowMore}
                    disabled={isLoadingMore}
                >
                    {isLoadingMore && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    Show more
                </Button>
            )}
        </div>
    );
}

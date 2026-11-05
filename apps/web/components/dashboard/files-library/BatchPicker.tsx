'use client';

import { useId, useState, type Ref } from 'react';
import { Loader2, Search } from 'lucide-react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { countLabel } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { BATCH_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '@/lib/library/paging';
import { useTRPC } from '@/lib/trpc/client';
import { formatBatchDate, toBatchView, type BatchView } from './batchSummary';

/** A batch files can go into: a real batch row, so never Ungrouped. */
export interface TargetBatch extends BatchView {
    batchId: string;
}

interface BatchPickerProps {
    /** Never offered: the batch the files are in now. */
    excludeBatchId?: string | null;
    pickedId: string | null;
    onPick: (batch: TargetBatch) => void;
    searchRef?: Ref<HTMLInputElement>;
}

/**
 * The user's batches, searched and paged in, to pick one to send files to:
 * moving them (#453) or uploading them (#454). Mounted only while its dialog
 * is open, so each open starts from a clear search.
 */
export function BatchPicker({
    excludeBatchId,
    pickedId,
    onPick,
    searchRef,
}: BatchPickerProps) {
    const trpc = useTRPC();
    const [search, setSearch] = useState('');
    const activeSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();
    // The library's own query when nothing is typed, so the first page is
    // usually in the cache already.
    const batchesQuery = useInfiniteQuery(
        trpc.files.listBatches.infiniteQueryOptions(
            { search: activeSearch || undefined, limit: BATCH_PAGE_SIZE },
            {
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
                    batch.batchId !== null && batch.batchId !== excludeBatchId
            ) ?? [];

    return (
        <>
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
                pickedId={pickedId}
                onPick={onPick}
                isLoading={batchesQuery.isPending}
                isSearching={activeSearch !== ''}
                hasMore={batchesQuery.hasNextPage}
                isLoadingMore={batchesQuery.isFetchingNextPage}
                onShowMore={() => void batchesQuery.fetchNextPage()}
            />
        </>
    );
}

interface TargetListProps {
    targets: TargetBatch[];
    pickedId: string | null;
    onPick: (batch: TargetBatch) => void;
    isLoading: boolean;
    isSearching: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    onShowMore: () => void;
}

function TargetList({
    targets,
    pickedId,
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
    // A short page can still have more behind it: the excluded batch and
    // Ungrouped are dropped here, not by the server.
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
                            checked={batch.batchId === pickedId}
                            onChange={() => onPick(batch)}
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

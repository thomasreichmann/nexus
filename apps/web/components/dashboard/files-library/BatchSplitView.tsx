import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { BatchMosaic } from './BatchMosaic';
import { SearchField } from './LibraryView';
import {
    formatBatchDate,
    formatCount,
    formatTimeLeft,
    type BatchSummary,
} from './batchSummary';

interface BatchSplitViewProps {
    openBatch: BatchSummary;
    batches: BatchSummary[];
    totalBatchCount: number;
    thumbnailUrls: Record<string, string>;
    search: string;
    onSearchChange: (value: string) => void;
    onBack: () => void;
    onSelect: (key: string) => void;
    onShowMore: () => void;
    /** The open batch's pane. */
    children: ReactNode;
}

export function BatchSplitView({
    openBatch,
    batches,
    totalBatchCount,
    thumbnailUrls,
    search,
    onSearchChange,
    onBack,
    onSelect,
    onShowMore,
    children,
}: BatchSplitViewProps) {
    const remaining = totalBatchCount - batches.length;
    return (
        <div className="flex flex-col gap-4">
            <nav
                data-fx="crumbs"
                aria-label="Breadcrumb"
                className="flex h-7 min-w-0 items-center gap-2 text-sm text-muted-foreground"
            >
                <button
                    type="button"
                    data-back
                    onClick={onBack}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md py-1 pr-2 pl-1 transition-colors hover:bg-muted hover:text-foreground"
                >
                    <ArrowLeft className="size-4" />
                    All batches
                </button>
                <span aria-hidden>/</span>
                <span className="min-w-0 truncate font-medium text-foreground">
                    {openBatch.name}
                </span>
            </nav>
            <div className="flex items-start gap-4">
                <section
                    data-fx="list"
                    aria-label="Batches"
                    className="sticky top-6 hidden max-h-[calc(100dvh-10rem)] w-75 shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:flex"
                >
                    <div data-fx="list-chrome" className="border-b p-3">
                        <SearchField value={search} onChange={onSearchChange} />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {batches.map((batch) => (
                            <BatchRow
                                key={batch.key}
                                batch={batch}
                                isCurrent={batch.key === openBatch.key}
                                thumbnailUrls={thumbnailUrls}
                                onSelect={() => onSelect(batch.key)}
                            />
                        ))}
                    </div>
                    <div
                        data-fx="list-chrome"
                        className="flex items-center justify-between border-t px-3 py-2.5 text-xs text-muted-foreground tabular-nums"
                    >
                        <span>
                            {formatCount(batches.length)} of{' '}
                            {formatCount(totalBatchCount)} batches
                        </span>
                        {remaining > 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onShowMore}
                            >
                                Show {formatCount(Math.min(remaining, 12))} more
                            </Button>
                        )}
                    </div>
                </section>
                {children}
            </div>
        </div>
    );
}

interface BatchRowProps {
    batch: BatchSummary;
    isCurrent: boolean;
    thumbnailUrls: Record<string, string>;
    onSelect: () => void;
}

function BatchRow({
    batch,
    isCurrent,
    thumbnailUrls,
    onSelect,
}: BatchRowProps) {
    return (
        <button
            type="button"
            data-fx-row={batch.key}
            aria-current={isCurrent}
            onClick={onSelect}
            className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-foreground/3 aria-current:bg-muted"
        >
            <BatchMosaic
                batch={batch}
                thumbnailUrls={thumbnailUrls}
                variant="thumb"
            />
            <span data-fx="row-text" className="block min-w-0 flex-1">
                <span className="flex justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                        {batch.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBatchDate(batch.createdAt)}
                    </span>
                </span>
                <RowStatus batch={batch} />
            </span>
        </button>
    );
}

function RowStatus({ batch }: { batch: BatchSummary }) {
    const base =
        'flex items-center gap-1.5 truncate text-xs text-muted-foreground tabular-nums';
    if (batch.status === 'restoring') {
        return (
            <span className={cn(base, 'text-blue-600 dark:text-blue-300')}>
                <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
                Restoring {formatCount(batch.restoringCount)} of{' '}
                {formatCount(batch.totalFileCount)}
            </span>
        );
    }
    if (batch.status === 'ready') {
        const timeLeft = formatTimeLeft(batch.readyUntil);
        return (
            <span
                className={cn(base, 'text-emerald-600 dark:text-emerald-300')}
            >
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                {formatCount(batch.readyCount)} ready
                {timeLeft && ` · ${timeLeft}`}
            </span>
        );
    }
    return (
        <span className={base}>
            {formatCount(batch.totalFileCount)} files ·{' '}
            {formatBytes(batch.totalBytes)}
        </span>
    );
}

import { memo } from 'react';
import { Download, RotateCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { BatchMosaic } from './BatchMosaic';
import {
    countLabel,
    formatBatchDate,
    formatCount,
    formatTimeLeft,
    type BatchSummary,
} from './batchSummary';

export interface LibraryCounts {
    archived: number;
    retrieving: number;
    available: number;
}

interface LibraryViewProps {
    batches: BatchSummary[];
    /** Batches matching the search; equals libraryBatchCount without one. */
    totalBatchCount: number;
    /** The stats line is library-wide, like the status counts beside it. */
    libraryBatchCount: number;
    counts: LibraryCounts;
    thumbnailUrls: Record<string, string>;
    search: string;
    onSearchChange: (value: string) => void;
    activeSearch: string;
    onOpen: (key: string) => void;
    onShowMore: () => void;
}

// Memoized for the same reason as BatchPane: it stays mounted (hidden)
// behind an open batch, and shouldn't re-render with every viewer frame.
export const LibraryView = memo(LibraryViewContent);

function LibraryViewContent({
    batches,
    totalBatchCount,
    libraryBatchCount,
    counts,
    thumbnailUrls,
    search,
    onSearchChange,
    activeSearch,
    onOpen,
    onShowMore,
}: LibraryViewProps) {
    const libraryTotal = counts.archived + counts.retrieving + counts.available;
    const remaining = totalBatchCount - batches.length;
    return (
        <div className="flex flex-col gap-4">
            <LibraryHeading data-fx="lib-chrome" />

            <div
                data-fx="lib-chrome"
                className="flex flex-wrap items-center gap-3 text-sm tabular-nums text-muted-foreground"
            >
                <span className="font-medium text-foreground">
                    {countLabel(libraryTotal, 'file')} in{' '}
                    {countLabel(libraryBatchCount, 'batch')}
                </span>
                <span className="hidden h-3.5 w-px bg-border sm:block" />
                {counts.archived > 0 && (
                    <span className="hidden items-center gap-1.5 sm:inline-flex">
                        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                        {formatCount(counts.archived)} archived
                    </span>
                )}
                {counts.retrieving > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-blue-500" />
                        {formatCount(counts.retrieving)} retrieving
                    </span>
                )}
                {counts.available > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        {formatCount(counts.available)} ready
                    </span>
                )}
            </div>

            <div
                data-fx="lib-chrome"
                className="flex items-center justify-between gap-3"
            >
                <SearchField
                    value={search}
                    onChange={onSearchChange}
                    className="w-full sm:max-w-100"
                />
                <span className="hidden shrink-0 text-[13px] text-muted-foreground sm:block">
                    Newest first
                </span>
            </div>

            {batches.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
                    <Search className="mb-3 size-5 text-muted-foreground/60" />
                    <p className="max-w-full px-4 text-sm wrap-break-word text-muted-foreground">
                        No batches or files match &ldquo;{activeSearch}&rdquo;
                    </p>
                </div>
            )}

            {batches.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                    {batches.map((batch) => (
                        <BatchCard
                            key={batch.key}
                            batch={batch}
                            thumbnailUrls={thumbnailUrls}
                            onOpen={() => onOpen(batch.key)}
                        />
                    ))}
                </div>
            )}

            {batches.length > 0 && (
                <div
                    data-fx="lib-chrome"
                    className="flex items-center justify-center gap-3 text-xs text-muted-foreground tabular-nums"
                >
                    <span>
                        Showing {formatCount(batches.length)} of{' '}
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
            )}
        </div>
    );
}

export function LibraryHeading(props: { 'data-fx'?: string }) {
    return (
        <div {...props}>
            <h1 className="text-2xl font-bold tracking-tight">Files</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
                Browse and manage your archived files
            </p>
        </div>
    );
}

interface SearchFieldProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function SearchField({ value, onChange, className }: SearchFieldProps) {
    return (
        <div className={cn('relative', className)}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
                type="search"
                placeholder="Search files and batches"
                aria-label="Search files and batches"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="pl-9"
            />
        </div>
    );
}

interface BatchCardProps {
    batch: BatchSummary;
    thumbnailUrls: Record<string, string>;
    onOpen: () => void;
}

function BatchCard({ batch, thumbnailUrls, onOpen }: BatchCardProps) {
    return (
        <button
            type="button"
            data-fx-card={batch.key}
            onClick={onOpen}
            aria-label={`Open ${batch.name}`}
            className={cn(
                'relative block min-w-0 cursor-pointer overflow-hidden rounded-xl border bg-card p-0 text-left',
                'transition-[translate,border-color] duration-200 ease-[cubic-bezier(.2,0,0,1)]',
                'hover:-translate-y-0.5 hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500',
                batch.status === 'restoring' && 'border-blue-500/45',
                batch.status === 'ready' && 'border-emerald-500/45'
            )}
        >
            <BatchMosaic
                batch={batch}
                thumbnailUrls={thumbnailUrls}
                variant="cover"
            >
                <StatusPill batch={batch} />
            </BatchMosaic>
            <span
                data-fx="card-body"
                className="block px-2.5 pt-2 pb-2.5 sm:px-3.25 sm:pt-2.75 sm:pb-3.25"
            >
                <span
                    data-fx="card-name"
                    className="line-clamp-2 block text-sm/4.5 font-semibold sm:line-clamp-none sm:truncate sm:text-[15px]/5.25"
                >
                    {batch.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                    {cardMeta(batch)}
                </span>
                <CardStatusLine batch={batch} />
            </span>
        </button>
    );
}

function CardStatusLine({ batch }: { batch: BatchSummary }) {
    const base =
        'mt-2 hidden h-4 items-center gap-1.5 text-xs text-muted-foreground sm:flex';
    if (batch.status === 'restoring') {
        return (
            <span className={base}>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/8">
                    <span
                        className="block h-full bg-blue-500"
                        style={{ width: `${restoringPercent(batch)}%` }}
                    />
                </span>
            </span>
        );
    }
    if (batch.status === 'ready') {
        return (
            <span className={base}>
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-300">
                    Download ready
                </span>
            </span>
        );
    }
    return (
        <span className={base}>
            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
            Archived
        </span>
    );
}

const PILL_STYLES = {
    restoring: { Icon: RotateCw, tone: 'text-blue-600 dark:text-blue-300' },
    ready: { Icon: Download, tone: 'text-emerald-600 dark:text-emerald-300' },
};

function StatusPill({ batch }: { batch: BatchSummary }) {
    if (batch.status === 'archived') return null;
    const { Icon, tone } = PILL_STYLES[batch.status];
    const { full, short } = pillLabels(batch);
    return (
        <span
            data-fx="pill"
            className={cn(
                'absolute bottom-2 left-2 flex items-center gap-1.25 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium tabular-nums',
                tone
            )}
        >
            <Icon className="size-3" strokeWidth={2.5} />
            <span className="hidden sm:inline">{full}</span>
            <span className="sm:hidden">{short}</span>
        </span>
    );
}

// The phone card is half as wide, so its pill drops the words around the
// numbers.
function pillLabels(batch: BatchSummary): { full: string; short: string } {
    const total = formatCount(batch.totalFileCount);
    if (batch.status === 'restoring') {
        const restoring = formatCount(batch.restoringCount);
        return {
            full: `Restoring ${restoring} of ${total}`,
            short: `${restoring} of ${total}`,
        };
    }
    const ready = `${formatCount(batch.readyCount)} ready`;
    const timeLeft = formatTimeLeft(batch.readyUntil);
    return { full: timeLeft ? `${ready} · ${timeLeft}` : ready, short: ready };
}

export function restoringPercent(batch: BatchSummary): number {
    return Math.max(3, (batch.restoringCount / batch.totalFileCount) * 100);
}

function cardMeta(batch: BatchSummary): string {
    let count = countLabel(batch.totalFileCount, 'file');
    if (batch.files.length < batch.totalFileCount) {
        count = `${formatCount(batch.files.length)} of ${count} match`;
    }
    return [
        count,
        formatBytes(batch.totalBytes),
        formatBatchDate(batch.createdAt),
    ]
        .filter(Boolean)
        .join(' · ');
}

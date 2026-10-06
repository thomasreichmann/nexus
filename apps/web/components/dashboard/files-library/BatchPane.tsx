'use client';

import { memo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
    Download,
    LayoutGrid,
    LayoutList,
    MoreHorizontal,
    RotateCw,
    Trash2,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { isProbablyCold } from '@nexus/db/objectState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPositioner,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RetrieveDialog } from '@/components/dashboard/RetrieveDialog';
import { DeleteDialog } from '@/components/dashboard/DeleteDialog';
import { MiddleTruncateName } from '@/components/dashboard/MiddleTruncateName';
import {
    FileActions,
    useFileActions,
} from '@/components/dashboard/file-browser/FileActions';
import { StatusDot } from '@/components/dashboard/file-browser/SelectableIcon';
import { toastRetrievalRequested } from '@/components/dashboard/file-browser/retrievalFeedback';
import {
    deriveStatus,
    getFileTypeInfo,
    type DerivedStatus,
} from '@/components/dashboard/file-browser/status';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { restoringPercent } from './LibraryView';
import {
    countLabel,
    formatBatchDate,
    formatCount,
    formatTimeLeft,
    type BatchSummary,
} from './batchSummary';
import type { FileWithRetrieval } from '@nexus/db/repo/files';

export type PaneViewMode = 'grid' | 'list';

interface BatchPaneProps {
    batch: BatchSummary;
    thumbnailUrls: Record<string, string>;
    fileLimit: number;
    onShowMoreFiles: () => void;
    selectedIds: Set<string>;
    onToggleFile: (index: number, shiftKey: boolean) => void;
    onToggleAll: () => void;
    viewMode: PaneViewMode;
    onViewModeChange: (mode: PaneViewMode) => void;
    /** Opens the file viewer; `aspect` is the tile thumbnail's, if loaded. */
    onOpenFile: (fileId: string, aspect: number | null) => void;
    onBatchDeleted: () => void;
}

// Memoized: the viewer's open/close re-renders the library several times a
// second, and a batch's 100 tiles shouldn't re-render with it.
export const BatchPane = memo(BatchPaneContent);

function BatchPaneContent({
    batch,
    thumbnailUrls,
    fileLimit,
    onShowMoreFiles,
    selectedIds,
    onToggleFile,
    onToggleAll,
    viewMode,
    onViewModeChange,
    onOpenFile,
    onBatchDeleted,
}: BatchPaneProps) {
    const shownFiles = batch.files.slice(0, fileLimit);
    const isAllSelected =
        batch.files.length > 0 && selectedIds.size === batch.files.length;
    const hasSelection = selectedIds.size > 0;
    const date = formatBatchDate(batch.createdAt);
    const isSearchSubset = batch.files.length < batch.totalFileCount;
    const FileItem = FILE_ITEMS[viewMode];

    return (
        <section
            data-fx="pane"
            aria-label="Batch contents"
            className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-card"
        >
            <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3.5 sm:flex-nowrap sm:px-5 sm:py-4.5">
                <div className="min-w-0 flex-auto">
                    <h2
                        data-fx="pane-title"
                        className="truncate text-[22px]/7.5 font-bold tracking-tight"
                    >
                        {batch.name}
                    </h2>
                    <p
                        data-fx="pane-chrome"
                        className="mt-0.5 text-[13px] text-muted-foreground tabular-nums"
                    >
                        {countLabel(batch.totalFileCount, 'file')} ·{' '}
                        {formatBytes(batch.totalBytes)}
                        {date && ` · uploaded ${date}`}
                    </p>
                    <BatchStatusLine batch={batch} />
                </div>
                <div
                    data-fx="pane-chrome"
                    className="flex shrink-0 flex-wrap items-center gap-2"
                >
                    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-input bg-foreground/4 px-2.5 text-[13px] font-medium tabular-nums">
                        <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={onToggleAll}
                        />
                        {isSearchSubset
                            ? `Select ${formatCount(batch.files.length)} matches`
                            : `Select all ${formatCount(batch.files.length)}`}
                    </label>
                    <div className="hidden rounded-lg border p-0.5 sm:flex">
                        <ViewModeButton
                            mode="list"
                            current={viewMode}
                            onChange={onViewModeChange}
                        />
                        <ViewModeButton
                            mode="grid"
                            current={viewMode}
                            onChange={onViewModeChange}
                        />
                    </div>
                    <BatchMenu batch={batch} onDeleted={onBatchDeleted} />
                </div>
            </div>

            <div data-fx="tiles" className={TILE_LAYOUTS[viewMode]}>
                {shownFiles.map((file, index) => {
                    const tileProps = {
                        file,
                        thumbnailUrl: thumbnailUrls[file.id],
                        isSelected: selectedIds.has(file.id),
                        hasSelection,
                        onToggle: (shiftKey: boolean) =>
                            onToggleFile(index, shiftKey),
                        onActivate: (e: ReactMouseEvent<HTMLElement>) => {
                            // Shift extends a range, Cmd/Ctrl toggles one,
                            // and once anything is selected a plain click
                            // keeps selecting. Otherwise a click opens.
                            if (e.shiftKey) onToggleFile(index, true);
                            else if (e.metaKey || e.ctrlKey || hasSelection)
                                onToggleFile(index, false);
                            else
                                onOpenFile(
                                    file.id,
                                    readAspect(e.currentTarget)
                                );
                        },
                        onOpen: (e: ReactMouseEvent<HTMLElement>) =>
                            onOpenFile(file.id, readAspect(e.currentTarget)),
                    };
                    return <FileItem key={file.id} {...tileProps} />;
                })}
            </div>

            <PagingFooter
                shownCount={shownFiles.length}
                totalCount={batch.files.length}
                isSearchSubset={isSearchSubset}
                onShowMore={onShowMoreFiles}
            />
        </section>
    );
}

const FILE_ITEMS = { grid: FileTile, list: FileListRow };

const TILE_LAYOUTS: Record<PaneViewMode, string> = {
    grid: 'grid grid-cols-3 gap-x-2.5 gap-y-3 px-4 pt-3 pb-1 sm:grid-cols-4 sm:px-5 sm:pt-3.5 xl:grid-cols-6',
    list: 'grid grid-cols-1 border-t',
};

function PagingFooter({
    shownCount,
    totalCount,
    isSearchSubset,
    onShowMore,
}: {
    shownCount: number;
    totalCount: number;
    isSearchSubset: boolean;
    onShowMore: () => void;
}) {
    const base =
        'flex items-center justify-center gap-3 px-5 pt-2.5 pb-3.5 text-xs text-muted-foreground tabular-nums';
    if (shownCount < totalCount) {
        return (
            <div data-fx="paging" className={base}>
                <span>
                    Showing {formatCount(shownCount)} of{' '}
                    {formatCount(totalCount)}
                </span>
                <Button variant="outline" size="sm" onClick={onShowMore}>
                    Show next{' '}
                    {formatCount(Math.min(100, totalCount - shownCount))}
                </Button>
            </div>
        );
    }
    let summary = `All ${countLabel(shownCount, 'file')}`;
    if (isSearchSubset) summary = countLabel(shownCount, 'matching file');
    else if (shownCount === 1) summary = '1 file';
    return (
        <div data-fx="paging" className={base}>
            <span>{summary}</span>
        </div>
    );
}

function BatchStatusLine({ batch }: { batch: BatchSummary }) {
    const base =
        'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] tabular-nums';
    if (batch.status === 'restoring') {
        return (
            <div
                data-fx="pane-chrome"
                className={cn(base, 'text-blue-600 dark:text-blue-300')}
            >
                <RotateCw className="size-3.5" />
                <span className="whitespace-nowrap">
                    Restoring {formatCount(batch.restoringCount)} of{' '}
                    {formatCount(batch.totalFileCount)} · ready within 48 hours
                </span>
                <span className="h-1 w-27.5 overflow-hidden rounded-full bg-foreground/8">
                    <span
                        data-fx="status-bar"
                        className="block h-full origin-left bg-blue-500"
                        style={{ width: `${restoringPercent(batch)}%` }}
                    />
                </span>
            </div>
        );
    }
    if (batch.status === 'ready') {
        const timeLeft = formatTimeLeft(batch.readyUntil);
        return (
            <div
                data-fx="pane-chrome"
                className={cn(base, 'text-emerald-600 dark:text-emerald-300')}
            >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <span className="whitespace-nowrap">
                    {formatCount(batch.readyCount)} ready to download
                    {timeLeft && ` · ${timeLeft}`}
                </span>
            </div>
        );
    }
    return (
        <div
            data-fx="pane-chrome"
            className={cn(base, 'text-muted-foreground')}
        >
            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
            <span className="whitespace-nowrap">
                Archived · retrieval takes up to 48 hours
            </span>
            <RestoreBatchButton batch={batch} />
        </div>
    );
}

function useBatchRestore(batch: BatchSummary) {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const onSuccess = (result: { fileCount: number }) => {
        invalidateFileList();
        toastRetrievalRequested(result.fileCount);
    };
    const batchMutation = useMutation(
        trpc.files.requestBatchRetrieval.mutationOptions({
            trpc: toastContext({
                errorMessage: 'Failed to request batch retrieval',
            }),
            onSuccess,
        })
    );
    // The legacy null-batch group has no id to restore by.
    const filesMutation = useMutation(
        trpc.files.requestBulkRetrieval.mutationOptions({
            trpc: toastContext({
                errorMessage: 'Failed to request retrievals',
            }),
            onSuccess,
        })
    );
    const eligibleFiles = batch.files.filter(
        (f) => deriveStatus(f) === 'archived'
    );
    return {
        eligibleFiles,
        isPending: batchMutation.isPending || filesMutation.isPending,
        // No tier: the router's default is the one place the restore tier is
        // decided (#423).
        restore() {
            if (batch.batchId) {
                batchMutation.mutate({ batchId: batch.batchId });
                return;
            }
            filesMutation.mutate({ fileIds: eligibleFiles.map((f) => f.id) });
        },
    };
}

function RestoreBatchButton({ batch }: { batch: BatchSummary }) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { eligibleFiles, isPending, restore } = useBatchRestore(batch);
    if (eligibleFiles.length === 0) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                disabled={isPending}
                className="inline-flex h-6 items-center gap-1.5 rounded-md bg-blue-500/12 px-2 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 disabled:opacity-60 dark:text-blue-300"
            >
                <RotateCw
                    className={cn('size-3', isPending && 'animate-spin')}
                    strokeWidth={2.5}
                />
                {isPending ? 'Requesting…' : 'Restore batch'}
            </button>
            <RetrieveDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                files={eligibleFiles}
                fileCount={eligibleFiles.length}
                onConfirm={restore}
            />
        </>
    );
}

function BatchMenu({
    batch,
    onDeleted,
}: {
    batch: BatchSummary;
    onDeleted: () => void;
}) {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const [isRetrieveOpen, setIsRetrieveOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const { eligibleFiles, restore } = useBatchRestore(batch);
    const deleteMutation = useMutation(
        trpc.files.deleteMany.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to delete batch' }),
            onSuccess() {
                invalidateFileList();
                onDeleted();
            },
        })
    );
    return (
        <>
            <RetrieveDialog
                open={isRetrieveOpen}
                onOpenChange={setIsRetrieveOpen}
                files={eligibleFiles}
                fileCount={eligibleFiles.length}
                onConfirm={restore}
            />
            <DeleteDialog
                open={isDeleteOpen}
                onOpenChange={setIsDeleteOpen}
                fileCount={batch.files.length}
                onConfirm={() =>
                    deleteMutation.mutate({
                        ids: batch.files.map((f) => f.id),
                    })
                }
            />
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            variant="outline"
                            size="icon-sm"
                            className="hidden sm:inline-flex"
                        />
                    }
                >
                    <MoreHorizontal className="size-4" />
                    <span className="sr-only">Batch actions</span>
                </DropdownMenuTrigger>
                <DropdownMenuPositioner align="end">
                    <DropdownMenuContent>
                        <DropdownMenuItem
                            onClick={() => setIsRetrieveOpen(true)}
                            disabled={eligibleFiles.length === 0}
                        >
                            <RotateCw className="mr-2 size-4" />
                            Restore batch
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setIsDeleteOpen(true)}
                            disabled={deleteMutation.isPending}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete {countLabel(batch.files.length, 'file')}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenuPositioner>
            </DropdownMenu>
        </>
    );
}

function ViewModeButton({
    mode,
    current,
    onChange,
}: {
    mode: PaneViewMode;
    current: PaneViewMode;
    onChange: (mode: PaneViewMode) => void;
}) {
    const { Icon, label } = VIEW_MODES[mode];
    return (
        <button
            type="button"
            onClick={() => onChange(mode)}
            aria-pressed={mode === current}
            className="grid size-6.5 place-items-center rounded-md text-muted-foreground transition-colors aria-pressed:bg-muted aria-pressed:text-foreground"
        >
            <Icon className="size-3.5" />
            <span className="sr-only">{label}</span>
        </button>
    );
}

const VIEW_MODES = {
    grid: { Icon: LayoutGrid, label: 'Grid view' },
    list: { Icon: LayoutList, label: 'List view' },
};

interface FileItemProps {
    file: FileWithRetrieval;
    thumbnailUrl: string | undefined;
    isSelected: boolean;
    hasSelection: boolean;
    onToggle: (shiftKey: boolean) => void;
    /** A click on the file: opens it, or selects in selection mode. */
    onActivate: (e: ReactMouseEvent<HTMLElement>) => void;
    /** Always opens, whatever the selection. */
    onOpen: (e: ReactMouseEvent<HTMLElement>) => void;
}

function FileTile({
    file,
    thumbnailUrl,
    isSelected,
    hasSelection,
    onToggle,
    onActivate,
    onOpen,
}: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    return (
        <figure
            data-fx="tile"
            data-file-id={file.id}
            className="group/tile m-0 min-w-0"
        >
            <div
                data-fx="tile-media"
                className="relative aspect-square overflow-hidden rounded-lg"
            >
                <button
                    type="button"
                    data-open-file
                    onClick={onActivate}
                    aria-label={tileLabel(file.name, isSelected, hasSelection)}
                    className={cn(
                        'absolute inset-0 block overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500',
                        hasSelection ? 'cursor-pointer' : 'cursor-zoom-in'
                    )}
                >
                    <FileMedia
                        file={file}
                        thumbnailUrl={thumbnailUrl}
                        isZoomable={!hasSelection}
                    />
                </button>
                {/* data-fx-decor: overlays a flying photo leaves behind. */}
                <span
                    data-fx-decor
                    className={cn(
                        'pointer-events-none absolute inset-0 rounded-lg',
                        isSelected
                            ? 'bg-primary/15 ring-2 ring-primary ring-inset'
                            : STATUS_RINGS[status]
                    )}
                />
                <StatusBadge status={status} />
                <span
                    data-fx-decor
                    onClick={(e) => e.stopPropagation()}
                    // flex: Base UI's checkbox root is an inline span, so its
                    // size-4 only applies as a flex item.
                    className={cn(
                        'absolute top-1.5 left-1.5 flex transition-opacity',
                        isSelected || hasSelection
                            ? 'opacity-100'
                            : 'opacity-0 group-hover/tile:opacity-100'
                    )}
                >
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggle(false)}
                        aria-label={`Select ${file.name}`}
                        className="bg-background/80"
                    />
                </span>
                <span
                    data-fx-decor
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 bottom-1 rounded-md bg-background/80 opacity-0 transition-opacity group-hover/tile:opacity-100 has-data-popup-open:opacity-100"
                >
                    <FileActions status={status} file={file} {...actions} />
                </span>
                <ExpandButton fileName={file.name} onOpen={onOpen} />
            </div>
            <figcaption className="mt-1.25 min-w-0 text-xs text-foreground/80">
                <MiddleTruncateName name={file.name} />
            </figcaption>
        </figure>
    );
}

function tileLabel(
    name: string,
    isSelected: boolean,
    hasSelection: boolean
): string {
    if (!hasSelection) return `Open ${name}`;
    if (isSelected) return `Deselect ${name}`;
    return `Select ${name}`;
}

const STATUS_RINGS: Record<DerivedStatus, string> = {
    archived: '',
    retrieving: 'ring-2 ring-blue-500/70 ring-inset',
    available: 'ring-2 ring-emerald-500/60 ring-inset',
};

const STATUS_BADGES = {
    retrieving: { Icon: RotateCw, tone: 'text-blue-600 dark:text-blue-300' },
    available: {
        Icon: Download,
        tone: 'text-emerald-600 dark:text-emerald-300',
    },
};

function StatusBadge({ status }: { status: DerivedStatus }) {
    if (status === 'archived') return null;
    const { Icon, tone } = STATUS_BADGES[status];
    return (
        <span
            data-fx="badge"
            className={cn(
                'pointer-events-none absolute top-1.25 right-1.25 grid size-5 place-items-center rounded-full bg-background/80',
                tone
            )}
        >
            <Icon className="size-3" strokeWidth={2.5} />
        </span>
    );
}

/**
 * The tile's "open" affordance. A plain click on the photo opens it too,
 * but in selection mode a click selects, so this is the one way in that
 * never changes. It rises in with the hover, and its two arrows spring out
 * to their corners: the icon acts out the expand it triggers.
 */
function ExpandButton({
    fileName,
    onOpen,
}: {
    fileName: string;
    onOpen: (e: ReactMouseEvent<HTMLElement>) => void;
}) {
    const arm =
        'transition-[translate] delay-75 duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover/tile:translate-x-0 group-hover/tile:translate-y-0 group-focus-visible/expand:translate-x-0 group-focus-visible/expand:translate-y-0 motion-reduce:transition-none';
    return (
        <button
            type="button"
            data-fx-decor
            onClick={onOpen}
            aria-label={`Open ${fileName}`}
            className={cn(
                'group/expand absolute bottom-1 left-1 grid size-8 place-items-center rounded-md bg-background/75 text-foreground shadow-sm backdrop-blur-sm',
                'translate-y-1 scale-90 opacity-0 transition-[opacity,translate,scale,background-color] duration-200 ease-[cubic-bezier(.2,0,0,1)]',
                'group-hover/tile:translate-y-0 group-hover/tile:scale-100 group-hover/tile:opacity-100 hover:bg-background',
                'focus-visible:translate-y-0 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-blue-500',
                'motion-reduce:transition-opacity'
            )}
        >
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="size-4 transition-[scale] duration-200 group-hover/expand:scale-115"
            >
                {/* Each arm rests tucked toward the centre (SVG user units). */}
                <g
                    className={cn(
                        arm,
                        '-translate-x-[2.5px] translate-y-[2.5px]'
                    )}
                >
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="21" x2="14" y1="3" y2="10" />
                </g>
                <g
                    className={cn(
                        arm,
                        'translate-x-[2.5px] -translate-y-[2.5px]'
                    )}
                >
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="3" x2="10" y1="21" y2="14" />
                </g>
            </svg>
        </button>
    );
}

function FileListRow({
    file,
    thumbnailUrl,
    isSelected,
    onToggle,
    onActivate,
}: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    return (
        <div
            data-fx="tile"
            data-file-id={file.id}
            onClick={onActivate}
            className={cn(
                'flex min-w-0 cursor-pointer items-center gap-3 border-b border-border/60 px-4 py-2 last:border-b-0 hover:bg-foreground/3 sm:px-5',
                isSelected && 'bg-primary/8'
            )}
        >
            <span className="flex" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggle(false)}
                    aria-label={`Select ${file.name}`}
                />
            </span>
            <div
                data-fx="tile-media"
                className="relative size-10 shrink-0 overflow-hidden rounded-md"
            >
                <FileMedia file={file} thumbnailUrl={thumbnailUrl} />
            </div>
            {/* The row takes mouse clicks; the name is its keyboard way in. */}
            <button
                type="button"
                data-open-file
                onClick={(e) => {
                    e.stopPropagation();
                    onActivate(e);
                }}
                className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-blue-500"
            >
                <MiddleTruncateName
                    name={file.name}
                    className="text-sm font-medium"
                />
            </button>
            <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                {formatBytes(file.size)}
            </span>
            <span className="hidden w-36 shrink-0 sm:block">
                <StatusDot status={status} isCold={isProbablyCold(file)} />
            </span>
            <span onClick={(e) => e.stopPropagation()}>
                <FileActions status={status} file={file} {...actions} />
            </span>
        </div>
    );
}

function FileMedia({
    file,
    thumbnailUrl,
    isZoomable = false,
}: {
    file: FileWithRetrieval;
    thumbnailUrl: string | undefined;
    /** Leans in on hover: the tile opens into the viewer. */
    isZoomable?: boolean;
}) {
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(file.name);
    const [isLoaded, setIsLoaded] = useState(false);
    return (
        <span className="absolute inset-0 bg-muted">
            <span
                className={cn(
                    'absolute inset-0 grid place-items-center',
                    colorClass
                )}
            >
                <TypeIcon className="size-6 opacity-60" strokeWidth={1.5} />
            </span>
            {thumbnailUrl && (
                // Presigned S3 URL — see SelectableIcon for why not next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={thumbnailUrl}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setIsLoaded(true)}
                    className={cn(
                        'absolute inset-0 size-full object-cover transition-[opacity,scale] duration-300 ease-out',
                        isLoaded ? 'opacity-100' : 'opacity-0',
                        isZoomable && 'group-hover/tile:scale-104'
                    )}
                />
            )}
        </span>
    );
}

// The tile's own thumbnail knows the photo's shape before the viewer does.
function readAspect(from: HTMLElement): number | null {
    const img = from
        .closest('[data-fx="tile"]')
        ?.querySelector<HTMLImageElement>('[data-fx="tile-media"] img');
    if (!img?.naturalWidth || !img.naturalHeight) return null;
    return img.naturalWidth / img.naturalHeight;
}

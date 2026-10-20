'use client';

import {
    memo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
} from 'react';
import {
    ChevronRight,
    Download,
    Folder,
    LayoutGrid,
    LayoutList,
    Loader2,
    MoreHorizontal,
    Pencil,
    RotateCw,
    Trash2,
} from 'lucide-react';
import { useIsMutating, useMutation } from '@tanstack/react-query';
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
    type ActionableFile,
    type FileAction,
} from '@/components/dashboard/file-browser/FileActions';
import { StatusDot } from '@/components/dashboard/file-browser/StatusDot';
import { toastRetrievalRequested } from '@/components/dashboard/file-browser/retrievalFeedback';
import {
    deriveStatus,
    getFileTypeInfo,
    type DerivedStatus,
} from '@/components/dashboard/file-browser/status';
import { cn } from '@/lib/cn';
import { countLabel, formatBytes, formatCount } from '@/lib/format';
import { FILE_PAGE_SIZE } from '@/lib/library/paging';
import type { PaneViewMode } from '@/lib/library/viewMode';
import { useTRPC } from '@/lib/trpc/client';
import { toastContext } from '@/lib/trpc/error-link';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import {
    folderLabel,
    formatBatchDate,
    formatTimeLeft,
    restoringPercent,
    type BatchView,
} from './batchSummary';
import { RenameBatchDialog } from './RenameBatchDialog';
import type { BatchSection } from './useBatchFiles';
import type { LibraryFile } from '@nexus/db/repo/library';

export type { PaneViewMode };

/**
 * What's selected in the open batch: the whole of it, loaded or not, which
 * runs its actions on the server by batch id (#455); or files picked one by
 * one. Picked files are kept whole, not as ids, so a pick in a folder that's
 * since been collapsed still goes with the selection's actions.
 */
export interface PaneSelection {
    isWholeBatch: boolean;
    files: Map<string, LibraryFile>;
}

interface BatchPaneProps {
    batch: BatchView;
    /** Null while the batch's structure is still loading. */
    sections: BatchSection[] | null;
    /** The loaded files of every expanded section. */
    loadedCount: number;
    thumbnailUrls: Record<string, string>;
    selection: PaneSelection;
    onToggleFile: (fileId: string, shiftKey: boolean) => void;
    onToggleAll: () => void;
    onToggleFolder: (sectionKey: string) => void;
    onLoadNext: (sectionKey: string) => void;
    onLoadPrevious: (sectionKey: string) => void;
    onRetrySection: (sectionKey: string) => void;
    viewMode: PaneViewMode;
    onViewModeChange: (mode: PaneViewMode) => void;
    /** Opens the file viewer; `aspect` is the tile thumbnail's, if loaded. */
    onOpenFile: (fileId: string, aspect: number | null) => void;
    /** A file menu's action, run or confirmed by the library (#477). */
    onFileAction: (action: FileAction, file: ActionableFile) => void;
    onBatchDeleted: () => void;
}

// Memoized: the viewer's open/close re-renders the library several times a
// second, and a batch's 100 tiles shouldn't re-render with it.
export const BatchPane = memo(BatchPaneContent);

function BatchPaneContent({
    batch,
    sections,
    loadedCount,
    thumbnailUrls,
    selection,
    onToggleFile,
    onToggleAll,
    onToggleFolder,
    onLoadNext,
    onLoadPrevious,
    onRetrySection,
    viewMode,
    onViewModeChange,
    onOpenFile,
    onFileAction,
    onBatchDeleted,
}: BatchPaneProps) {
    const hasSelection = selection.isWholeBatch || selection.files.size > 0;
    const date = formatBatchDate(batch.createdAt);
    const restore = useBatchRestore(batch);

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
                        {countLabel(batch.fileCount, 'file')} ·{' '}
                        {formatBytes(batch.totalBytes)}
                        {date && ` · uploaded ${date}`}
                    </p>
                    <BatchStatusLine batch={batch} restore={restore} />
                </div>
                <div
                    data-fx="pane-chrome"
                    className="flex shrink-0 flex-wrap items-center gap-2"
                >
                    <SelectAll
                        batch={batch}
                        loadedCount={loadedCount}
                        selection={selection}
                        onToggle={onToggleAll}
                    />
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
                    <BatchMenu
                        batch={batch}
                        restore={restore}
                        onDeleted={onBatchDeleted}
                    />
                </div>
            </div>

            {sections === null ? (
                <PaneLoading />
            ) : (
                sections.map((section) => (
                    <FileSection
                        key={section.key}
                        section={section}
                        isSearchSubset={batch.matchCount !== null}
                        thumbnailUrls={thumbnailUrls}
                        selection={selection}
                        hasSelection={hasSelection}
                        viewMode={viewMode}
                        onToggleFile={onToggleFile}
                        onToggleFolder={onToggleFolder}
                        onLoadNext={onLoadNext}
                        onLoadPrevious={onLoadPrevious}
                        onRetry={onRetrySection}
                        onOpenFile={onOpenFile}
                        onFileAction={onFileAction}
                    />
                ))
            )}
        </section>
    );
}

/**
 * The pane's select-all. With every file showing it selects the whole batch,
 * loaded or not (#455). A search's matches are selected as loaded rows, and
 * when some aren't loaded yet the label says so.
 */
interface SelectAllProps {
    batch: BatchView;
    loadedCount: number;
    selection: PaneSelection;
    onToggle: () => void;
}

function SelectAll({
    batch,
    loadedCount,
    selection,
    onToggle,
}: SelectAllProps) {
    const isSubset = batch.matchCount !== null;
    let label = `Select all ${formatCount(batch.fileCount)}`;
    let isChecked = selection.isWholeBatch;
    if (isSubset) {
        const matchCount = batch.matchCount ?? 0;
        label =
            loadedCount < matchCount
                ? `Select ${formatCount(loadedCount)} loaded matches`
                : `Select ${formatCount(matchCount)} matches`;
        isChecked = loadedCount > 0 && selection.files.size === loadedCount;
    }
    return (
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-input bg-foreground/4 px-2.5 text-[13px] font-medium tabular-nums">
            <Checkbox
                checked={isChecked}
                onCheckedChange={onToggle}
                aria-label={label}
            />
            {label}
        </label>
    );
}

function PaneLoading() {
    return (
        <div
            role="status"
            className="flex items-center justify-center gap-2 border-t px-5 py-16 text-sm text-muted-foreground"
        >
            <Loader2 className="size-4 animate-spin" />
            Loading files...
        </div>
    );
}

interface SectionErrorProps {
    onRetry: () => void;
}

// A page that failed after its retries: in place of the files when it was
// the first, under them when it was one more.
function SectionError({ onRetry }: SectionErrorProps) {
    return (
        <div
            role="alert"
            className="flex items-center justify-center gap-3 px-5 pt-2.5 pb-3.5 text-sm text-muted-foreground"
        >
            Couldn&rsquo;t load these files.
            <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
            </Button>
        </div>
    );
}

interface FileSectionProps {
    section: BatchSection;
    isSearchSubset: boolean;
    thumbnailUrls: Record<string, string>;
    selection: PaneSelection;
    hasSelection: boolean;
    viewMode: PaneViewMode;
    onToggleFile: (fileId: string, shiftKey: boolean) => void;
    onToggleFolder: (sectionKey: string) => void;
    onLoadNext: (sectionKey: string) => void;
    onLoadPrevious: (sectionKey: string) => void;
    onRetry: (sectionKey: string) => void;
    onOpenFile: (fileId: string, aspect: number | null) => void;
    onFileAction: (action: FileAction, file: ActionableFile) => void;
}

/**
 * A run of the batch's files: the whole of a flat batch, or one folder of a
 * batch with structure inside (#405), under a row that collapses it.
 */
function FileSection({
    section,
    isSearchSubset,
    thumbnailUrls,
    selection,
    hasSelection,
    viewMode,
    onToggleFile,
    onToggleFolder,
    onLoadNext,
    onLoadPrevious,
    onRetry,
    onOpenFile,
    onFileAction,
}: FileSectionProps) {
    const FileItem = FILE_ITEMS[viewMode];
    const isEmpty = section.files.length === 0;
    const isEmptyLoading = section.isLoading && isEmpty;
    const error = section.isError && (
        <SectionError onRetry={() => onRetry(section.key)} />
    );
    return (
        <div className={cn(section.folder && 'border-t')}>
            {section.folder && (
                <FolderRow
                    section={section}
                    isSearchSubset={isSearchSubset}
                    onToggle={() => onToggleFolder(section.key)}
                />
            )}
            {section.isExpanded && (
                <>
                    {section.hasPrevious && (
                        <div
                            data-fx="paging"
                            className="flex justify-center px-5 pt-3 pb-1"
                        >
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onLoadPrevious(section.key)}
                                disabled={section.isLoading}
                            >
                                Show earlier files
                            </Button>
                        </div>
                    )}
                    {isEmptyLoading && <PaneLoading />}
                    {isEmpty && error}
                    {!isEmpty && (
                        <div data-fx="tiles" className={TILE_LAYOUTS[viewMode]}>
                            {section.files.map((file) => (
                                <FileItem
                                    key={file.id}
                                    file={file}
                                    thumbnailUrl={thumbnailUrls[file.id]}
                                    isSelected={
                                        selection.isWholeBatch ||
                                        selection.files.has(file.id)
                                    }
                                    hasSelection={hasSelection}
                                    onToggle={(shiftKey) =>
                                        onToggleFile(file.id, shiftKey)
                                    }
                                    onActivate={(e) => {
                                        // Shift extends a range, Cmd/Ctrl
                                        // toggles one, and once anything is
                                        // selected a plain click keeps
                                        // selecting. Otherwise a click opens.
                                        if (e.shiftKey)
                                            onToggleFile(file.id, true);
                                        else if (
                                            e.metaKey ||
                                            e.ctrlKey ||
                                            hasSelection
                                        )
                                            onToggleFile(file.id, false);
                                        else
                                            onOpenFile(
                                                file.id,
                                                readAspect(e.currentTarget)
                                            );
                                    }}
                                    onOpen={(e) =>
                                        onOpenFile(
                                            file.id,
                                            readAspect(e.currentTarget)
                                        )
                                    }
                                    onAction={onFileAction}
                                />
                            ))}
                        </div>
                    )}
                    {!isEmpty && error}
                    {!isEmptyLoading && !section.isError && (
                        <PagingFooter
                            section={section}
                            isSearchSubset={isSearchSubset}
                            onShowMore={() => onLoadNext(section.key)}
                        />
                    )}
                </>
            )}
        </div>
    );
}

interface FolderRowProps {
    section: BatchSection;
    isSearchSubset: boolean;
    onToggle: () => void;
}

function FolderRow({ section, isSearchSubset, onToggle }: FolderRowProps) {
    const folder = section.folder!;
    const label = folderLabel(folder.subpath);
    const count =
        isSearchSubset && folder.matchCount !== null
            ? `${formatCount(folder.matchCount)} of ${countLabel(folder.fileCount, 'file')} match`
            : countLabel(folder.fileCount, 'file');
    return (
        <button
            type="button"
            data-fx="folder"
            aria-expanded={section.isExpanded}
            aria-label={`${label}, ${count}`}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-foreground/3 sm:px-5"
        >
            <ChevronRight
                className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    section.isExpanded && 'rotate-90'
                )}
            />
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <MiddleTruncateName
                name={label}
                className={cn(
                    'min-w-0 flex-1 font-medium',
                    folder.subpath === null && 'text-muted-foreground'
                )}
            />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {count}
            </span>
        </button>
    );
}

const FILE_ITEMS = { grid: FileTile, list: FileListRow };

const TILE_LAYOUTS: Record<PaneViewMode, string> = {
    grid: 'grid grid-cols-3 gap-x-2.5 gap-y-3 px-4 pt-3 pb-1 sm:grid-cols-4 sm:px-5 sm:pt-3.5 xl:grid-cols-6',
    list: 'grid grid-cols-1 border-t',
};

interface PagingFooterProps {
    section: BatchSection;
    isSearchSubset: boolean;
    onShowMore: () => void;
}

function PagingFooter({
    section,
    isSearchSubset,
    onShowMore,
}: PagingFooterProps) {
    const base =
        'flex items-center justify-center gap-3 px-5 pt-2.5 pb-3.5 text-xs text-muted-foreground tabular-nums';
    const shownCount = section.files.length;
    const totalCount = section.total;
    if (section.hasNext || section.hasPrevious) {
        const remaining = totalCount - shownCount;
        return (
            <div data-fx="paging" className={base}>
                <span>
                    Showing {formatCount(shownCount)} of{' '}
                    {formatCount(totalCount)}
                </span>
                {section.hasNext && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onShowMore}
                        disabled={section.isLoading}
                    >
                        {section.isLoading
                            ? 'Loading…'
                            : `Show next ${formatCount(Math.min(FILE_PAGE_SIZE, remaining))}`}
                    </Button>
                )}
            </div>
        );
    }
    // A folder's row already says how many files it holds.
    if (section.folder) return <div className="pb-2" />;
    let summary = `All ${countLabel(shownCount, 'file')}`;
    if (isSearchSubset) summary = countLabel(shownCount, 'matching file');
    else if (shownCount === 1) summary = '1 file';
    return (
        <div data-fx="paging" className={base}>
            <span>{summary}</span>
        </div>
    );
}

interface BatchStatusLineProps {
    batch: BatchView;
    restore: BatchRestore;
}

function BatchStatusLine({ batch, restore }: BatchStatusLineProps) {
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
                    {formatCount(batch.fileCount)} · ready within 48 hours
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
            <RestoreBatchButton batch={batch} restore={restore} />
        </div>
    );
}

export interface BatchRestore {
    /** A restore of this batch is on its way, asked for here or elsewhere. */
    isPending: boolean;
    restore: () => void;
}

/**
 * The whole batch's restore, by batch id on the server (#455): its archived
 * files, however many the browser has loaded. The legacy Ungrouped group
 * restores the same way, with no id.
 */
export function useBatchRestore(
    batch: BatchView,
    onRestored?: () => void
): BatchRestore {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const mutation = useMutation(
        trpc.files.requestBatchRetrieval.mutationOptions({
            trpc: toastContext({
                errorMessage: 'Failed to request batch retrieval',
            }),
            onSuccess(result) {
                invalidateFileList();
                toastRetrievalRequested(result.fileCount);
                onRestored?.();
            },
        })
    );
    const pendingCount = useIsMutating({
        mutationKey: trpc.files.requestBatchRetrieval.mutationKey(),
        predicate: (m) => isForBatch(m.state.variables, batch.batchId),
    });
    return {
        isPending: pendingCount > 0,
        // No tier: the router's default is the one place the restore tier is
        // decided (#423).
        restore: () => mutation.mutate({ batchId: batch.batchId }),
    };
}

// The pane's status line and menu and the selection bar each start a batch
// action; one in flight from any of them holds the others.
function isForBatch(variables: unknown, batchId: string | null): boolean {
    const input = variables as { batchId?: string | null } | undefined;
    return input?.batchId === batchId;
}

interface BatchRetrieveDialogProps {
    batch: BatchView;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}

/** The confirm step every whole-batch restore goes through. */
export function BatchRetrieveDialog({
    batch,
    open,
    onOpenChange,
    onConfirm,
}: BatchRetrieveDialogProps) {
    return (
        <RetrieveDialog
            open={open}
            onOpenChange={onOpenChange}
            fileCount={batch.archivedCount}
            probablyColdCount={batch.archivedProbablyColdCount}
            onConfirm={onConfirm}
        />
    );
}

interface RestoreBatchButtonProps {
    batch: BatchView;
    restore: BatchRestore;
}

function RestoreBatchButton({
    batch,
    restore: { isPending, restore },
}: RestoreBatchButtonProps) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    if (batch.archivedCount === 0) return null;
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
            <BatchRetrieveDialog
                batch={batch}
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                onConfirm={restore}
            />
        </>
    );
}

export interface BatchDelete {
    /** A delete of this batch is on its way, asked for here or elsewhere. */
    isPending: boolean;
    remove: () => void;
}

/**
 * The whole batch's delete, by batch id on the server (#455), behind #403's
 * confirm with the batch's file count.
 */
export function useBatchDelete(
    batch: BatchView,
    onDeleted: () => void
): BatchDelete {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();
    const mutation = useMutation(
        trpc.files.deleteBatch.mutationOptions({
            trpc: toastContext({ errorMessage: 'Failed to delete batch' }),
            onSuccess() {
                invalidateFileList();
                onDeleted();
            },
        })
    );
    const pendingCount = useIsMutating({
        mutationKey: trpc.files.deleteBatch.mutationKey(),
        predicate: (m) => isForBatch(m.state.variables, batch.batchId),
    });
    return {
        isPending: pendingCount > 0,
        remove: () => mutation.mutate({ batchId: batch.batchId }),
    };
}

interface BatchMenuProps {
    batch: BatchView;
    restore: BatchRestore;
    onDeleted: () => void;
}

function BatchMenu({ batch, restore, onDeleted }: BatchMenuProps) {
    const [isRenameOpen, setIsRenameOpen] = useState(false);
    const [isRetrieveOpen, setIsRetrieveOpen] = useState(false);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const { isPending: isDeleting, remove } = useBatchDelete(batch, onDeleted);
    return (
        <>
            {/* The legacy Ungrouped files have no batch row to name. Keyed so a
                rename still in flight stays with its own batch's dialog. */}
            {batch.batchId !== null && (
                <RenameBatchDialog
                    key={batch.batchId}
                    batchId={batch.batchId}
                    name={batch.name}
                    open={isRenameOpen}
                    onOpenChange={setIsRenameOpen}
                />
            )}
            <BatchRetrieveDialog
                batch={batch}
                open={isRetrieveOpen}
                onOpenChange={setIsRetrieveOpen}
                onConfirm={restore.restore}
            />
            <DeleteDialog
                open={isDeleteOpen}
                onOpenChange={setIsDeleteOpen}
                fileCount={batch.fileCount}
                onConfirm={remove}
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
                        {batch.batchId !== null && (
                            <DropdownMenuItem
                                onClick={() => setIsRenameOpen(true)}
                            >
                                <Pencil className="mr-2 size-4" />
                                Rename batch
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                            onClick={() => setIsRetrieveOpen(true)}
                            disabled={
                                batch.archivedCount === 0 || restore.isPending
                            }
                        >
                            <RotateCw className="mr-2 size-4" />
                            Restore batch
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setIsDeleteOpen(true)}
                            disabled={isDeleting}
                        >
                            <Trash2 className="mr-2 size-4" />
                            Delete batch
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenuPositioner>
            </DropdownMenu>
        </>
    );
}

interface ViewModeButtonProps {
    mode: PaneViewMode;
    current: PaneViewMode;
    onChange: (mode: PaneViewMode) => void;
}

function ViewModeButton({ mode, current, onChange }: ViewModeButtonProps) {
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
    file: LibraryFile;
    thumbnailUrl: string | undefined;
    isSelected: boolean;
    hasSelection: boolean;
    onToggle: (shiftKey: boolean) => void;
    /** A click on the file: opens it, or selects in selection mode. */
    onActivate: (e: ReactMouseEvent<HTMLElement>) => void;
    /** Always opens, whatever the selection. */
    onOpen: (e: ReactMouseEvent<HTMLElement>) => void;
    onAction: (action: FileAction, file: ActionableFile) => void;
}

function FileTile({
    file,
    thumbnailUrl,
    isSelected,
    hasSelection,
    onToggle,
    onActivate,
    onOpen,
    onAction,
}: FileItemProps) {
    const status = deriveStatus(file);
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
                <FileCheckbox
                    name={file.name}
                    isSelected={isSelected}
                    onToggle={onToggle}
                    data-fx-decor
                    // flex: Base UI's checkbox root is an inline span, so its
                    // size-4 only applies as a flex item.
                    className={cn(
                        'absolute top-1.5 left-1.5 flex transition-opacity',
                        isSelected || hasSelection
                            ? 'opacity-100'
                            : 'opacity-0 group-hover/tile:opacity-100'
                    )}
                    checkboxClassName="bg-background/80"
                />
                <span
                    data-fx-decor
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 bottom-1 rounded-md bg-background/80 opacity-0 transition-opacity group-hover/tile:opacity-100 has-data-popup-open:opacity-100"
                >
                    <FileActions
                        status={status}
                        file={file}
                        onAction={onAction}
                    />
                </span>
                <ExpandButton
                    fileName={file.name}
                    hasSelection={hasSelection}
                    onOpen={onOpen}
                />
            </div>
            <figcaption className="mt-1.25 min-w-0 text-xs text-foreground/80">
                <MiddleTruncateName name={file.name} />
            </figcaption>
        </figure>
    );
}

interface FileCheckboxProps {
    name: string;
    isSelected: boolean;
    onToggle: (shiftKey: boolean) => void;
    className?: string;
    checkboxClassName?: string;
    'data-fx-decor'?: boolean;
}

/**
 * A file's checkbox. Its change event carries no modifier keys, so Shift is
 * read off the pointer on its way in: a shift-click on a checkbox extends the
 * range, as one on the file does. The pointer, not the click: Base UI toggles
 * by clicking its hidden input, and that click passes through here too, with
 * no Shift on it.
 */
function FileCheckbox({
    name,
    isSelected,
    onToggle,
    className,
    checkboxClassName,
    'data-fx-decor': isDecor,
}: FileCheckboxProps) {
    const isShiftClick = useRef(false);
    return (
        <span
            data-fx-decor={isDecor}
            onPointerDownCapture={(e) => {
                isShiftClick.current = e.shiftKey;
            }}
            // A shift-press that never became a click (dragged off) mustn't
            // turn the next toggle, from the keyboard, into a range.
            onKeyDownCapture={() => {
                isShiftClick.current = false;
            }}
            onClick={(e) => e.stopPropagation()}
            className={className}
        >
            <Checkbox
                checked={isSelected}
                onCheckedChange={() => {
                    const isRange = isShiftClick.current;
                    isShiftClick.current = false;
                    onToggle(isRange);
                }}
                aria-label={`Select ${name}`}
                className={checkboxClassName}
            />
        </span>
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

interface ExpandButtonProps {
    fileName: string;
    hasSelection: boolean;
    onOpen: (e: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * The tile's "open" affordance. A plain click on the photo opens it too,
 * but in selection mode a click selects, so this is the one way in that
 * never changes. It rises in with the hover, and its two arrows spring out
 * to their corners: the icon acts out the expand it triggers.
 *
 * Out of selection mode the photo's own button already says "Open", so this
 * one stays out of the tab order and the accessibility tree: one stop and
 * one name per file.
 */
function ExpandButton({ fileName, hasSelection, onOpen }: ExpandButtonProps) {
    const arm =
        'transition-[translate] delay-75 duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover/tile:translate-x-0 group-hover/tile:translate-y-0 group-focus-visible/expand:translate-x-0 group-focus-visible/expand:translate-y-0 motion-reduce:transition-none';
    return (
        <button
            type="button"
            data-fx-decor
            onClick={onOpen}
            aria-label={`Open ${fileName}`}
            {...(!hasSelection && { tabIndex: -1, 'aria-hidden': true })}
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
    onAction,
}: FileItemProps) {
    const status = deriveStatus(file);
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
            <FileCheckbox
                name={file.name}
                isSelected={isSelected}
                onToggle={onToggle}
                className="flex"
            />
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
                <FileActions status={status} file={file} onAction={onAction} />
            </span>
        </div>
    );
}

function FileMedia({
    file,
    thumbnailUrl,
    isZoomable = false,
}: {
    file: LibraryFile;
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
                // Presigned S3 URL: next/image would need remotePatterns per
                // bucket domain and re-proxy the bytes. A plain img is the point.
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

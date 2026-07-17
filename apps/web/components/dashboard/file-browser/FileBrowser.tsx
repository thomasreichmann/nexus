'use client';

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogDescription,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card } from '@/components/ui/card';
import { ResponsiveRows } from '@/components/ui/responsive-rows';
import { StackedList } from '@/components/ui/stacked-list';
import {
    Search,
    LayoutGrid,
    LayoutList,
    Trash2,
    RotateCw,
    Loader2,
    X,
    Snowflake,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useInvalidateFileList } from '@/lib/hooks/useInvalidateFileList';
import { RetrieveDialog } from '@/components/dashboard/RetrieveDialog';
import { deriveStatus } from './status';
import { BatchHeader, BatchHeaderRow } from './BatchHeader';
import { FileRow } from './FileRow';
import { FileCard } from './FileCard';
import { MobileFileRow } from './MobileFileRow';

const SEARCH_DEBOUNCE_MS = 300;

interface FileBrowserProps {
    /** Deep-link target (`?file={id}`): scroll to and highlight this file. */
    focusFileId?: string;
}

export function FileBrowser({ focusFileId }: FileBrowserProps) {
    const trpc = useTRPC();
    const invalidateFileList = useInvalidateFileList();

    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    // Inverted: store collapsed keys so a brand-new batch (no entry yet) reads
    // as expanded. Default empty set → everything expanded on first render.
    const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(
        () => new Set()
    );
    const lastSelectedIndex = useRef<number | null>(null);

    const debouncedSearch = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);

    const { data: groupsData, isLoading } = useQuery(
        trpc.files.listGrouped.queryOptions({})
    );
    const { data: countsData } = useQuery(
        trpc.files.statusCounts.queryOptions()
    );

    const groups = useMemo(() => groupsData ?? [], [groupsData]);
    const counts = countsData ?? { archived: 0, retrieving: 0, available: 0 };

    // Seeded from the deep-link so the target row is highlighted from first
    // paint; cleared on a timer once we've scrolled to it.
    const [highlightedFileId, setHighlightedFileId] = useState<string | null>(
        focusFileId ?? null
    );
    const hasScrolledToFocus = useRef(false);

    // Deep-link focus (retrieval-ready email lands here): attached to the
    // target row in both views, fires when the row mounts. Guarded so later
    // remounts (search filter, view-mode toggle) don't re-scroll.
    const focusRowRef = useCallback((node: HTMLElement | null) => {
        if (!node || hasScrolledToFocus.current) return;
        // The list view is dual markup (stacked rows below sm, table above)
        // and both copies carry this ref — skip the display:none one so the
        // guard isn't consumed by a copy that can't scroll.
        if (node.offsetParent === null) return;
        hasScrolledToFocus.current = true;

        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => setHighlightedFileId(null), 2500);
    }, []);

    // Search filters files inside each group and drops groups that empty out.
    // Client-side is fine for the validation cohort; revisit when datasets grow.
    const filteredGroups = useMemo(() => {
        if (!debouncedSearch.trim()) return groups;
        const q = debouncedSearch.trim().toLowerCase();
        return groups
            .map((g) => ({
                ...g,
                files: g.files.filter((f) => f.name.toLowerCase().includes(q)),
            }))
            .filter((g) => g.files.length > 0);
    }, [groups, debouncedSearch]);

    // Flat visible-file ordering — the index space for shift-click range
    // selection across batches. Rebuilds when filter or groups change.
    const visibleFiles = useMemo(
        () => filteredGroups.flatMap((g) => g.files),
        [filteredGroups]
    );
    const fileIndexMap = useMemo(() => {
        const m = new Map<string, number>();
        visibleFiles.forEach((f, i) => m.set(f.id, i));
        return m;
    }, [visibleFiles]);

    const deleteManyMutation = useMutation(
        trpc.files.deleteMany.mutationOptions({
            onSuccess() {
                invalidateFileList();
                setSelectedFiles([]);
            },
        })
    );

    const bulkRetrievalMutation = useMutation(
        trpc.files.requestBulkRetrieval.mutationOptions({
            onSuccess() {
                invalidateFileList();
                setSelectedFiles([]);
                toast.success('Retrieval requests submitted');
            },
        })
    );

    const hasRestoringFiles = counts.retrieving > 0;
    const hasSelection = selectedFiles.length > 0;
    const selectedFileObjects = visibleFiles.filter((f) =>
        selectedFiles.includes(f.id)
    );
    // Only archived files can be retrieved — available ones already have a
    // download window and retrieving ones are in flight.
    const retrievableSelectedFiles = selectedFileObjects.filter(
        (f) => deriveStatus(f) === 'archived'
    );
    const hasArchivedSelected = retrievableSelectedFiles.length > 0;
    const [isRetrieveDialogOpen, setIsRetrieveDialogOpen] = useState(false);

    const toggleSelectAll = () => {
        if (selectedFiles.length === visibleFiles.length) {
            setSelectedFiles([]);
        } else {
            setSelectedFiles(visibleFiles.map((f) => f.id));
        }
    };

    const handleSelect = (id: string, index: number, shiftKey: boolean) => {
        setSelectedFiles((prev) => {
            if (
                shiftKey &&
                lastSelectedIndex.current !== null &&
                lastSelectedIndex.current !== index
            ) {
                const start = Math.min(lastSelectedIndex.current, index);
                const end = Math.max(lastSelectedIndex.current, index);
                const rangeIds = visibleFiles
                    .slice(start, end + 1)
                    .map((f) => f.id);
                return Array.from(new Set([...prev, ...rangeIds]));
            }
            return prev.includes(id)
                ? prev.filter((f) => f !== id)
                : [...prev, id];
        });
        lastSelectedIndex.current = index;
    };

    function handleBulkDelete() {
        deleteManyMutation.reset();
        deleteManyMutation.mutate({ ids: selectedFiles });
    }

    function handleBulkRetrieval() {
        const archivedIds = retrievableSelectedFiles.map((f) => f.id);
        if (archivedIds.length > 0) {
            bulkRetrievalMutation.reset();
            bulkRetrievalMutation.mutate({ fileIds: archivedIds });
        }
    }

    const isExpanded = (key: string) => !collapsedBatches.has(key);
    const toggleExpanded = (key: string) =>
        setCollapsedBatches((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <div className="relative">
                    <div className="size-12 rounded-xl bg-muted" />
                    <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-muted-foreground" />
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                    Loading vault...
                </p>
            </div>
        );
    }

    const hasActiveSearch = debouncedSearch.trim() !== '';
    const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
    const isEmpty = totalFiles === 0 && !hasActiveSearch;

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center justify-center py-24">
                <div className="relative mb-6">
                    <div className="flex size-20 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/50">
                        <Snowflake
                            className="size-8 text-muted-foreground/60"
                            strokeWidth={1.5}
                        />
                    </div>
                </div>
                <h3 className="text-lg font-semibold tracking-tight">
                    Your vault is empty
                </h3>
                <p className="mt-1.5 max-w-xs text-center text-sm text-muted-foreground">
                    Upload files to archive them in deep cold storage. Retrieval
                    takes 3-12 hours when you need them.
                </p>
                <Button
                    nativeButton={false}
                    render={<a href="/dashboard/upload" />}
                    className="mt-6"
                >
                    Upload files
                </Button>
            </div>
        );
    }

    const libraryTotal = counts.archived + counts.retrieving + counts.available;

    return (
        <div className="space-y-4">
            {/* Stats bar — counts are library-wide, not page-scoped */}
            <div className="flex items-center gap-4 text-sm">
                <span className="font-medium tabular-nums">
                    {libraryTotal} file{libraryTotal !== 1 ? 's' : ''}
                </span>
                <span className="h-3.5 w-px bg-border" />
                <div className="flex items-center gap-3 text-muted-foreground">
                    {counts.archived > 0 && (
                        <span className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                            {counts.archived} archived
                        </span>
                    )}
                    {counts.retrieving > 0 && (
                        <span className="flex items-center gap-1.5">
                            <span className="relative size-1.5 rounded-full bg-blue-500">
                                <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/60" />
                            </span>
                            {counts.retrieving} retrieving
                        </span>
                    )}
                    {counts.available > 0 && (
                        <span className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            {counts.available} available
                        </span>
                    )}
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3">
                <div className="relative w-full max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    {hasRestoringFiles && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => invalidateFileList()}
                            title="Refresh"
                        >
                            <RotateCw className="size-4" />
                        </Button>
                    )}
                    <div className="flex items-center rounded-lg border border-border p-0.5">
                        <button
                            type="button"
                            className={cn(
                                'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
                                viewMode === 'list' &&
                                    'bg-muted text-foreground shadow-sm'
                            )}
                            onClick={() => setViewMode('list')}
                        >
                            <LayoutList className="size-3.5" />
                            <span className="sr-only">List view</span>
                        </button>
                        <button
                            type="button"
                            className={cn(
                                'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
                                viewMode === 'grid' &&
                                    'bg-muted text-foreground shadow-sm'
                            )}
                            onClick={() => setViewMode('grid')}
                        >
                            <LayoutGrid className="size-3.5" />
                            <span className="sr-only">Grid view</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="relative">
                {filteredGroups.length === 0 && hasActiveSearch ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
                        <Search className="mb-3 size-5 text-muted-foreground/60" />
                        <p className="max-w-full break-words px-4 text-sm text-muted-foreground">
                            No files match &ldquo;{debouncedSearch.trim()}
                            &rdquo;
                        </p>
                    </div>
                ) : viewMode === 'list' ? (
                    <ResponsiveRows
                        mobile={
                            <>
                                {/* The desktop table's select-all lives in its
                                    (hidden) header, so the stacked list carries
                                    its own select-all row. */}
                                <div className="flex items-center gap-2.5 px-2 pb-3">
                                    <Checkbox
                                        checked={
                                            hasSelection &&
                                            selectedFiles.length ===
                                                visibleFiles.length
                                        }
                                        onCheckedChange={toggleSelectAll}
                                        aria-label="Select all"
                                    />
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Select all
                                    </span>
                                </div>
                                <div className="space-y-6">
                                    {filteredGroups.map((group) => {
                                        const key =
                                            group.batchId ?? '__ungrouped__';
                                        const expanded = isExpanded(key);
                                        return (
                                            <section key={key}>
                                                <BatchHeader
                                                    group={group}
                                                    expanded={expanded}
                                                    onToggle={() =>
                                                        toggleExpanded(key)
                                                    }
                                                />
                                                {expanded && (
                                                    <StackedList>
                                                        {group.files.map(
                                                            (file) => (
                                                                <MobileFileRow
                                                                    key={
                                                                        file.id
                                                                    }
                                                                    ref={
                                                                        file.id ===
                                                                        focusFileId
                                                                            ? focusRowRef
                                                                            : undefined
                                                                    }
                                                                    file={file}
                                                                    isSelected={selectedFiles.includes(
                                                                        file.id
                                                                    )}
                                                                    isHighlighted={
                                                                        file.id ===
                                                                        highlightedFileId
                                                                    }
                                                                    hasSelection={
                                                                        hasSelection
                                                                    }
                                                                    onSelect={(
                                                                        shiftKey
                                                                    ) =>
                                                                        handleSelect(
                                                                            file.id,
                                                                            fileIndexMap.get(
                                                                                file.id
                                                                            ) ??
                                                                                0,
                                                                            shiftKey
                                                                        )
                                                                    }
                                                                />
                                                            )
                                                        )}
                                                    </StackedList>
                                                )}
                                            </section>
                                        );
                                    })}
                                </div>
                            </>
                        }
                        desktop={
                            <Card className="py-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="w-[52px] pl-4">
                                                <div className="flex size-8 items-center justify-center">
                                                    <Checkbox
                                                        checked={
                                                            hasSelection &&
                                                            selectedFiles.length ===
                                                                visibleFiles.length
                                                        }
                                                        onCheckedChange={
                                                            toggleSelectAll
                                                        }
                                                        aria-label="Select all"
                                                    />
                                                </div>
                                            </TableHead>
                                            <TableHead>
                                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                    Name
                                                </span>
                                            </TableHead>
                                            <TableHead>
                                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                    Size
                                                </span>
                                            </TableHead>
                                            <TableHead>
                                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                    Uploaded
                                                </span>
                                            </TableHead>
                                            <TableHead>
                                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                                    Status
                                                </span>
                                            </TableHead>
                                            <TableHead className="w-12" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredGroups.map((group) => {
                                            const key =
                                                group.batchId ??
                                                '__ungrouped__';
                                            const expanded = isExpanded(key);
                                            return (
                                                <Fragment key={key}>
                                                    <BatchHeaderRow
                                                        group={group}
                                                        expanded={expanded}
                                                        onToggle={() =>
                                                            toggleExpanded(key)
                                                        }
                                                        colSpan={6}
                                                    />
                                                    {expanded &&
                                                        group.files.map(
                                                            (file) => (
                                                                <FileRow
                                                                    key={
                                                                        file.id
                                                                    }
                                                                    ref={
                                                                        file.id ===
                                                                        focusFileId
                                                                            ? focusRowRef
                                                                            : undefined
                                                                    }
                                                                    file={file}
                                                                    isSelected={selectedFiles.includes(
                                                                        file.id
                                                                    )}
                                                                    isHighlighted={
                                                                        file.id ===
                                                                        highlightedFileId
                                                                    }
                                                                    hasSelection={
                                                                        hasSelection
                                                                    }
                                                                    onSelect={(
                                                                        shiftKey
                                                                    ) =>
                                                                        handleSelect(
                                                                            file.id,
                                                                            fileIndexMap.get(
                                                                                file.id
                                                                            ) ??
                                                                                0,
                                                                            shiftKey
                                                                        )
                                                                    }
                                                                />
                                                            )
                                                        )}
                                                </Fragment>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </Card>
                        }
                    />
                ) : (
                    <div className="space-y-6">
                        {filteredGroups.map((group) => {
                            const key = group.batchId ?? '__ungrouped__';
                            const expanded = isExpanded(key);
                            return (
                                <section key={key}>
                                    <BatchHeader
                                        group={group}
                                        expanded={expanded}
                                        onToggle={() => toggleExpanded(key)}
                                    />
                                    <div
                                        className={cn(
                                            'grid transition-[grid-template-rows] duration-300 ease-out',
                                            expanded
                                                ? 'grid-rows-[1fr]'
                                                : 'grid-rows-[0fr]'
                                        )}
                                    >
                                        <div className="overflow-hidden">
                                            <div className="grid gap-3 pt-3 pl-9 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                                {group.files.map((file) => (
                                                    <FileCard
                                                        key={file.id}
                                                        ref={
                                                            file.id ===
                                                            focusFileId
                                                                ? focusRowRef
                                                                : undefined
                                                        }
                                                        file={file}
                                                        isSelected={selectedFiles.includes(
                                                            file.id
                                                        )}
                                                        isHighlighted={
                                                            file.id ===
                                                            highlightedFileId
                                                        }
                                                        hasSelection={
                                                            hasSelection
                                                        }
                                                        onSelect={(shiftKey) =>
                                                            handleSelect(
                                                                file.id,
                                                                fileIndexMap.get(
                                                                    file.id
                                                                ) ?? 0,
                                                                shiftKey
                                                            )
                                                        }
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Floating selection bar */}
            {hasSelection && (
                <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg">
                        <span className="text-sm font-medium tabular-nums">
                            {selectedFiles.length} selected
                        </span>
                        <span className="h-4 w-px bg-border" />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setIsRetrieveDialogOpen(true)}
                            disabled={
                                !hasArchivedSelected ||
                                bulkRetrievalMutation.isPending
                            }
                        >
                            {bulkRetrievalMutation.isPending ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                                <RotateCw className="mr-1.5 size-3.5" />
                            )}
                            Retrieve
                        </Button>
                        <RetrieveDialog
                            open={isRetrieveDialogOpen}
                            onOpenChange={setIsRetrieveDialogOpen}
                            tiers={retrievableSelectedFiles.map(
                                (f) => f.storageTier
                            )}
                            fileCount={retrievableSelectedFiles.length}
                            onConfirm={handleBulkRetrieval}
                        />
                        <AlertDialog>
                            <AlertDialogTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                    />
                                }
                                disabled={deleteManyMutation.isPending}
                            >
                                {deleteManyMutation.isPending ? (
                                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                ) : (
                                    <Trash2 className="mr-1.5 size-3.5" />
                                )}
                                Delete
                            </AlertDialogTrigger>
                            <AlertDialogPopup>
                                <AlertDialogTitle>
                                    Delete {selectedFiles.length} file
                                    {selectedFiles.length > 1 ? 's' : ''}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    This action cannot be undone. The selected
                                    files will be permanently deleted.
                                </AlertDialogDescription>
                                <div className="flex justify-end gap-2">
                                    <AlertDialogCancel>
                                        Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={handleBulkDelete}
                                    >
                                        Delete
                                    </AlertDialogAction>
                                </div>
                            </AlertDialogPopup>
                        </AlertDialog>
                        <span className="h-4 w-px bg-border" />
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSelectedFiles([])}
                        >
                            <X className="size-3.5" />
                            <span className="sr-only">Clear selection</span>
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

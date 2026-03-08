'use client';

import { useCallback, useRef, useState } from 'react';
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPositioner,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import {
    Search,
    LayoutGrid,
    LayoutList,
    MoreHorizontal,
    Download,
    Trash2,
    Clock,
    FileIcon,
    FileText,
    FileImage,
    FileVideo,
    FileAudio,
    FileArchive,
    FileCode,
    ArrowUpDown,
    RotateCw,
    Loader2,
    X,
    Snowflake,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { File } from '@nexus/db/repo/files';

type DerivedStatus = 'archived' | 'retrieving' | 'available';

type SortKey = 'name' | 'size' | 'uploadedAt';
type SortOrder = 'asc' | 'desc';

function deriveStatus(file: File): DerivedStatus {
    if (file.status === 'restoring') return 'retrieving';
    if (
        file.status === 'available' &&
        (file.storageTier === 'glacier' || file.storageTier === 'deep_archive')
    )
        return 'archived';
    return 'available';
}

function getFileExtension(name: string): string {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function getFileTypeInfo(name: string): {
    icon: typeof FileIcon;
    colorClass: string;
} {
    const ext = getFileExtension(name);

    const imageExts = [
        'jpg',
        'jpeg',
        'png',
        'gif',
        'svg',
        'webp',
        'bmp',
        'ico',
    ];
    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'];
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];
    const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'];
    const codeExts = [
        'js',
        'ts',
        'tsx',
        'jsx',
        'py',
        'rb',
        'go',
        'rs',
        'java',
        'c',
        'cpp',
        'h',
        'css',
        'html',
        'json',
        'yaml',
        'yml',
        'xml',
        'sql',
        'sh',
    ];
    const docExts = [
        'pdf',
        'doc',
        'docx',
        'txt',
        'md',
        'rtf',
        'xls',
        'xlsx',
        'csv',
        'ppt',
        'pptx',
    ];

    if (imageExts.includes(ext))
        return { icon: FileImage, colorClass: 'text-rose-500 bg-rose-500/10' };
    if (videoExts.includes(ext))
        return {
            icon: FileVideo,
            colorClass: 'text-purple-500 bg-purple-500/10',
        };
    if (audioExts.includes(ext))
        return {
            icon: FileAudio,
            colorClass: 'text-amber-500 bg-amber-500/10',
        };
    if (archiveExts.includes(ext))
        return {
            icon: FileArchive,
            colorClass: 'text-orange-500 bg-orange-500/10',
        };
    if (codeExts.includes(ext))
        return {
            icon: FileCode,
            colorClass: 'text-emerald-500 bg-emerald-500/10',
        };
    if (docExts.includes(ext))
        return { icon: FileText, colorClass: 'text-blue-500 bg-blue-500/10' };
    return { icon: FileIcon, colorClass: 'text-muted-foreground bg-muted' };
}

function StatusDot({ status }: { status: DerivedStatus }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span
                className={cn(
                    'relative inline-block size-2 rounded-full',
                    status === 'archived' && 'bg-muted-foreground/50',
                    status === 'retrieving' && 'bg-blue-500',
                    status === 'available' && 'bg-emerald-500'
                )}
            >
                {status === 'retrieving' && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/60" />
                )}
            </span>
            <span
                className={cn(
                    'text-xs capitalize',
                    status === 'archived' && 'text-muted-foreground',
                    status === 'retrieving' &&
                        'text-blue-600 dark:text-blue-400',
                    status === 'available' &&
                        'text-emerald-600 dark:text-emerald-400'
                )}
            >
                {status}
            </span>
        </span>
    );
}

/**
 * File icon that morphs into a checkbox on hover or when in selection mode.
 * Renders at a fixed size to prevent layout shift.
 */
function SelectableIcon({
    name,
    checked,
    onCheckedChange,
    showCheckbox,
    size = 'sm',
}: {
    name: string;
    checked: boolean;
    onCheckedChange: () => void;
    showCheckbox: boolean;
    size?: 'sm' | 'md';
}) {
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(name);
    const isSmall = size === 'sm';
    const containerClass = isSmall ? 'size-8' : 'size-10';
    const iconClass = isSmall ? 'size-4' : 'size-5';
    const reveal = checked || showCheckbox;

    return (
        <button
            type="button"
            className={cn(
                'group/icon relative flex shrink-0 items-center justify-center rounded-lg transition-colors',
                containerClass,
                reveal ? 'bg-primary/10' : colorClass
            )}
            onClick={(e) => {
                e.stopPropagation();
                onCheckedChange();
            }}
            aria-label={`Select ${name}`}
        >
            <TypeIcon
                className={cn(
                    iconClass,
                    'transition-opacity',
                    reveal
                        ? 'opacity-0'
                        : 'opacity-100 group-hover/icon:opacity-0'
                )}
            />
            <div
                className={cn(
                    'absolute inset-0 flex items-center justify-center transition-opacity',
                    reveal
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/icon:opacity-100'
                )}
            >
                <Checkbox
                    checked={checked}
                    tabIndex={-1}
                    onCheckedChange={onCheckedChange}
                    aria-hidden
                />
            </div>
        </button>
    );
}

export function FileBrowser() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>('uploadedAt');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
    const lastSelectedIndex = useRef<number | null>(null);

    const listOptions = trpc.files.list.queryOptions();
    const { data, isLoading } = useQuery(listOptions);

    const files = data?.files ?? [];

    const invalidateFileList = () =>
        queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

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

    const filteredFiles = files.filter((file) =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const sortedFiles = [...filteredFiles].sort((a, b) => {
        let comparison = 0;
        switch (sortKey) {
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'size':
                comparison = a.size - b.size;
                break;
            case 'uploadedAt':
                comparison =
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime();
                break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
    });

    const hasRestoringFiles = filteredFiles.some(
        (f) => f.status === 'restoring'
    );

    const hasSelection = selectedFiles.length > 0;

    const selectedFileObjects = files.filter((f) =>
        selectedFiles.includes(f.id)
    );
    const hasArchivedSelected = selectedFileObjects.some(
        (f) => deriveStatus(f) === 'archived'
    );

    const statusCounts = {
        archived: files.filter((f) => deriveStatus(f) === 'archived').length,
        retrieving: files.filter((f) => deriveStatus(f) === 'retrieving')
            .length,
        available: files.filter((f) => deriveStatus(f) === 'available').length,
    };

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortOrder('desc');
        }
    };

    const toggleSelectAll = () => {
        if (selectedFiles.length === sortedFiles.length) {
            setSelectedFiles([]);
        } else {
            setSelectedFiles(sortedFiles.map((f) => f.id));
        }
    };

    const handleSelect = useCallback(
        (id: string, index: number, shiftKey: boolean) => {
            setSelectedFiles((prev) => {
                if (
                    shiftKey &&
                    lastSelectedIndex.current !== null &&
                    lastSelectedIndex.current !== index
                ) {
                    const start = Math.min(lastSelectedIndex.current, index);
                    const end = Math.max(lastSelectedIndex.current, index);
                    const rangeIds = sortedFiles
                        .slice(start, end + 1)
                        .map((f) => f.id);
                    const merged = new Set([...prev, ...rangeIds]);
                    return Array.from(merged);
                }
                return prev.includes(id)
                    ? prev.filter((f) => f !== id)
                    : [...prev, id];
            });
            lastSelectedIndex.current = index;
        },
        [sortedFiles]
    );

    function handleBulkDelete() {
        deleteManyMutation.reset();
        deleteManyMutation.mutate({ ids: selectedFiles });
    }

    function handleBulkRetrieval() {
        const archivedIds = selectedFileObjects
            .filter((f) => deriveStatus(f) === 'archived')
            .map((f) => f.id);
        if (archivedIds.length > 0) {
            bulkRetrievalMutation.reset();
            bulkRetrievalMutation.mutate({ fileIds: archivedIds });
        }
    }

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

    const isEmpty = filteredFiles.length === 0 && searchQuery === '';

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

    return (
        <div className="space-y-4">
            {/* Stats bar */}
            {files.length > 0 && (
                <div className="flex items-center gap-4 text-sm">
                    <span className="font-medium tabular-nums">
                        {files.length} file{files.length !== 1 ? 's' : ''}
                    </span>
                    <span className="h-3.5 w-px bg-border" />
                    <div className="flex items-center gap-3 text-muted-foreground">
                        {statusCounts.archived > 0 && (
                            <span className="flex items-center gap-1.5">
                                <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                                {statusCounts.archived} archived
                            </span>
                        )}
                        {statusCounts.retrieving > 0 && (
                            <span className="flex items-center gap-1.5">
                                <span className="relative size-1.5 rounded-full bg-blue-500">
                                    <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/60" />
                                </span>
                                {statusCounts.retrieving} retrieving
                            </span>
                        )}
                        {statusCounts.available > 0 && (
                            <span className="flex items-center gap-1.5">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                {statusCounts.available} available
                            </span>
                        )}
                    </div>
                </div>
            )}

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
                            onClick={invalidateFileList}
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
            {filteredFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
                    <Search className="mb-3 size-5 text-muted-foreground/60" />
                    <p className="text-sm text-muted-foreground">
                        No files match &ldquo;{searchQuery}&rdquo;
                    </p>
                </div>
            ) : viewMode === 'list' ? (
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
                                                    sortedFiles.length
                                            }
                                            onCheckedChange={toggleSelectAll}
                                            aria-label="Select all"
                                        />
                                    </div>
                                </TableHead>
                                <TableHead>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                                        onClick={() => toggleSort('name')}
                                    >
                                        Name
                                        <ArrowUpDown className="size-3" />
                                    </button>
                                </TableHead>
                                <TableHead>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                                        onClick={() => toggleSort('size')}
                                    >
                                        Size
                                        <ArrowUpDown className="size-3" />
                                    </button>
                                </TableHead>
                                <TableHead>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                                        onClick={() => toggleSort('uploadedAt')}
                                    >
                                        Uploaded
                                        <ArrowUpDown className="size-3" />
                                    </button>
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
                            {sortedFiles.map((file, index) => (
                                <FileRow
                                    key={file.id}
                                    file={file}
                                    isSelected={selectedFiles.includes(file.id)}
                                    hasSelection={hasSelection}
                                    onSelect={(shiftKey) =>
                                        handleSelect(file.id, index, shiftKey)
                                    }
                                />
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sortedFiles.map((file, index) => (
                        <FileCard
                            key={file.id}
                            file={file}
                            isSelected={selectedFiles.includes(file.id)}
                            hasSelection={hasSelection}
                            onSelect={(shiftKey) =>
                                handleSelect(file.id, index, shiftKey)
                            }
                        />
                    ))}
                </div>
            )}

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
                            onClick={handleBulkRetrieval}
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

interface FileItemProps {
    file: File;
    isSelected: boolean;
    hasSelection: boolean;
    onSelect: (shiftKey: boolean) => void;
}

function useFileActions(file: File) {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const listQueryKey = trpc.files.list.queryOptions().queryKey;

    const invalidateFileList = () =>
        queryClient.invalidateQueries({ queryKey: listQueryKey });

    const deleteMutation = useMutation(
        trpc.files.delete.mutationOptions({
            onSuccess: invalidateFileList,
        })
    );

    const retrievalMutation = useMutation(
        trpc.files.requestRetrieval.mutationOptions({
            onSuccess() {
                invalidateFileList();
                toast.success('Retrieval request submitted');
            },
        })
    );

    async function handleDownload() {
        try {
            const { url } = await queryClient.fetchQuery(
                trpc.files.getDownloadUrl.queryOptions({ fileId: file.id })
            );
            window.open(url, '_blank');
        } catch {
            toast.error('Failed to get download URL');
        }
    }

    return {
        onDelete: () => deleteMutation.mutate({ id: file.id }),
        onRetrieval: () => retrievalMutation.mutate({ fileId: file.id }),
        onDownload: handleDownload,
        isDeleting: deleteMutation.isPending,
        isRetrieving: retrievalMutation.isPending,
    };
}

function FileRow({ file, isSelected, hasSelection, onSelect }: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    const ext = getFileExtension(file.name);

    return (
        <TableRow
            data-state={isSelected ? 'selected' : undefined}
            className={cn(
                'cursor-pointer transition-colors',
                isSelected &&
                    'bg-primary/[0.04] hover:bg-primary/[0.06] dark:bg-primary/[0.08] dark:hover:bg-primary/[0.10]'
            )}
            onClick={(e) => onSelect(e.shiftKey)}
        >
            <TableCell className="pl-4">
                <SelectableIcon
                    name={file.name}
                    checked={isSelected}
                    onCheckedChange={() => onSelect(false)}
                    showCheckbox={hasSelection}
                    size="sm"
                />
            </TableCell>
            <TableCell>
                <div className="min-w-0">
                    <p className="truncate font-medium leading-tight">
                        {file.name}
                    </p>
                    {ext && (
                        <p className="text-xs uppercase text-muted-foreground">
                            {ext}
                        </p>
                    )}
                </div>
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
                {formatBytes(file.size)}
            </TableCell>
            <TableCell className="text-muted-foreground">
                {formatDate(file.createdAt)}
            </TableCell>
            <TableCell>
                <StatusDot status={status} />
            </TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
                <FileActions status={status} {...actions} />
            </TableCell>
        </TableRow>
    );
}

function FileCard({ file, isSelected, hasSelection, onSelect }: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    const ext = getFileExtension(file.name);

    return (
        <Card
            className={cn(
                'group relative cursor-pointer py-0 transition-all',
                isSelected
                    ? 'ring-2 ring-primary/30 bg-primary/[0.02] dark:bg-primary/[0.06]'
                    : 'hover:border-border/80'
            )}
            onClick={(e) => onSelect(e.shiftKey)}
        >
            <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between">
                    <SelectableIcon
                        name={file.name}
                        checked={isSelected}
                        onCheckedChange={() => onSelect(false)}
                        showCheckbox={hasSelection}
                        size="md"
                    />
                    <div
                        className={cn(
                            'transition-opacity',
                            hasSelection
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 [&:has([data-state=open])]:opacity-100'
                        )}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <FileActions status={status} {...actions} />
                    </div>
                </div>
                <p className="truncate text-sm font-medium leading-tight">
                    {file.name}
                </p>
                <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs tabular-nums text-muted-foreground">
                        {formatBytes(file.size)}
                        {ext && (
                            <>
                                <span className="mx-1 text-border">/</span>
                                <span className="uppercase">{ext}</span>
                            </>
                        )}
                    </span>
                    <StatusDot status={status} />
                </div>
            </CardContent>
        </Card>
    );
}

interface FileActionsProps {
    status: DerivedStatus;
    onDelete: () => void;
    onRetrieval: () => void;
    onDownload: () => void;
    isDeleting: boolean;
    isRetrieving: boolean;
}

function FileActions({
    status,
    onDelete,
    onRetrieval,
    onDownload,
    isDeleting,
    isRetrieving,
}: FileActionsProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" />}
            >
                <MoreHorizontal className="size-4" />
                <span className="sr-only">Actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuPositioner align="end">
                <DropdownMenuContent>
                    {status === 'archived' && (
                        <DropdownMenuItem
                            onClick={onRetrieval}
                            disabled={isRetrieving}
                        >
                            {isRetrieving ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                            ) : (
                                <Clock className="mr-2 size-4" />
                            )}
                            Request retrieval
                        </DropdownMenuItem>
                    )}
                    {status === 'available' && (
                        <DropdownMenuItem onClick={onDownload}>
                            <Download className="mr-2 size-4" />
                            Download
                        </DropdownMenuItem>
                    )}
                    {status === 'retrieving' && (
                        <DropdownMenuItem disabled>
                            <RotateCw className="mr-2 size-4" />
                            Retrieving...
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={onDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                            <Trash2 className="mr-2 size-4" />
                        )}
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenuPositioner>
        </DropdownMenu>
    );
}

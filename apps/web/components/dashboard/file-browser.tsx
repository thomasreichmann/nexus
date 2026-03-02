'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Badge } from '@/components/ui/badge';
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
    FolderArchive,
    ArrowUpDown,
    RotateCw,
    Loader2,
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

function getStatusBadge(status: DerivedStatus) {
    switch (status) {
        case 'archived':
            return (
                <Badge
                    variant="secondary"
                    className="bg-muted text-muted-foreground"
                >
                    Archived
                </Badge>
            );
        case 'retrieving':
            return (
                <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary"
                >
                    Retrieving
                </Badge>
            );
        case 'available':
            return (
                <Badge
                    variant="secondary"
                    className="bg-green-500/10 text-green-600"
                >
                    Available
                </Badge>
            );
    }
}

export function FileBrowser() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>('uploadedAt');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const listOptions = trpc.files.list.queryOptions();
    const { data, isLoading } = useQuery(listOptions);

    const files = data?.files ?? [];

    const invalidateFileList = () =>
        queryClient.invalidateQueries({ queryKey: listOptions.queryKey });

    const deleteMutation = useMutation(
        trpc.files.delete.mutationOptions({
            onSuccess: invalidateFileList,
        })
    );

    const deleteManyMutation = useMutation(
        trpc.files.deleteMany.mutationOptions({
            onSuccess() {
                invalidateFileList();
                setSelectedFiles([]);
            },
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

    const selectedFileObjects = files.filter((f) =>
        selectedFiles.includes(f.id)
    );
    const hasArchivedSelected = selectedFileObjects.some(
        (f) => deriveStatus(f) === 'archived'
    );

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

    const toggleSelect = (id: string) => {
        setSelectedFiles((prev) =>
            prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
        );
    };

    function handleDelete(id: string) {
        deleteMutation.mutate({ id });
    }

    function handleBulkDelete() {
        // TODO: Replace with AlertDialog component when available
        const count = selectedFiles.length;
        if (
            window.confirm(
                `Delete ${count} file${count > 1 ? 's' : ''}? This cannot be undone.`
            )
        ) {
            deleteManyMutation.mutate({ ids: selectedFiles });
        }
    }

    function handleRetrieval(fileId: string) {
        retrievalMutation.mutate({ fileId });
    }

    function handleBulkRetrieval() {
        const archivedIds = selectedFileObjects
            .filter((f) => deriveStatus(f) === 'archived')
            .map((f) => f.id);
        if (archivedIds.length > 0) {
            bulkRetrievalMutation.mutate({ fileIds: archivedIds });
        }
    }

    async function handleDownload(fileId: string) {
        try {
            const { url } = await queryClient.fetchQuery(
                trpc.files.getDownloadUrl.queryOptions({ fileId })
            );
            window.open(url, '_blank');
        } catch {
            toast.error('Failed to get download URL');
        }
    }

    if (isLoading) {
        return (
            <Card>
                <CardContent className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    const isEmpty = filteredFiles.length === 0 && searchQuery === '';

    if (isEmpty) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <FolderArchive className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mb-2 text-lg font-semibold">No files yet</h3>
                    <p className="mb-4 text-center text-muted-foreground">
                        Upload your first files to get started with deep
                        storage.
                    </p>
                    <Button
                        nativeButton={false}
                        render={<a href="/dashboard/upload" />}
                    >
                        Upload files
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-2">
                    {selectedFiles.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                                {selectedFiles.length} selected
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleBulkRetrieval}
                                disabled={
                                    !hasArchivedSelected ||
                                    bulkRetrievalMutation.isPending
                                }
                            >
                                {bulkRetrievalMutation.isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <RotateCw className="mr-2 h-4 w-4" />
                                )}
                                Retrieve
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive bg-transparent"
                                onClick={handleBulkDelete}
                                disabled={deleteManyMutation.isPending}
                            >
                                {deleteManyMutation.isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Trash2 className="mr-2 h-4 w-4" />
                                )}
                                Delete
                            </Button>
                        </div>
                    )}
                    {hasRestoringFiles && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={invalidateFileList}
                            title="Refresh"
                        >
                            <RotateCw className="h-4 w-4" />
                        </Button>
                    )}
                    <div className="flex items-center rounded-lg border border-border">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                'rounded-r-none',
                                viewMode === 'list' && 'bg-muted'
                            )}
                            onClick={() => setViewMode('list')}
                        >
                            <LayoutList className="h-4 w-4" />
                            <span className="sr-only">List view</span>
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                'rounded-l-none',
                                viewMode === 'grid' && 'bg-muted'
                            )}
                            onClick={() => setViewMode('grid')}
                        >
                            <LayoutGrid className="h-4 w-4" />
                            <span className="sr-only">Grid view</span>
                        </Button>
                    </div>
                </div>
            </div>

            {filteredFiles.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <Search className="mb-4 h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">
                            No files match your search
                        </p>
                    </CardContent>
                </Card>
            ) : viewMode === 'list' ? (
                <Card>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">
                                    <Checkbox
                                        checked={
                                            selectedFiles.length ===
                                            sortedFiles.length
                                        }
                                        onCheckedChange={toggleSelectAll}
                                        aria-label="Select all"
                                    />
                                </TableHead>
                                <TableHead>
                                    <Button
                                        variant="ghost"
                                        className="-ml-4 h-8"
                                        onClick={() => toggleSort('name')}
                                    >
                                        Name
                                        <ArrowUpDown className="ml-2 h-4 w-4" />
                                    </Button>
                                </TableHead>
                                <TableHead>
                                    <Button
                                        variant="ghost"
                                        className="-ml-4 h-8"
                                        onClick={() => toggleSort('size')}
                                    >
                                        Size
                                        <ArrowUpDown className="ml-2 h-4 w-4" />
                                    </Button>
                                </TableHead>
                                <TableHead>
                                    <Button
                                        variant="ghost"
                                        className="-ml-4 h-8"
                                        onClick={() => toggleSort('uploadedAt')}
                                    >
                                        Uploaded
                                        <ArrowUpDown className="ml-2 h-4 w-4" />
                                    </Button>
                                </TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedFiles.map((file) => (
                                <FileRow
                                    key={file.id}
                                    file={file}
                                    isSelected={selectedFiles.includes(file.id)}
                                    onToggleSelect={() => toggleSelect(file.id)}
                                    onDelete={() => handleDelete(file.id)}
                                    onRetrieval={() => handleRetrieval(file.id)}
                                    onDownload={() => handleDownload(file.id)}
                                    isDeleting={
                                        deleteMutation.isPending &&
                                        deleteMutation.variables?.id === file.id
                                    }
                                    isRetrieving={
                                        retrievalMutation.isPending &&
                                        retrievalMutation.variables?.fileId ===
                                            file.id
                                    }
                                />
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sortedFiles.map((file) => (
                        <FileCard
                            key={file.id}
                            file={file}
                            isSelected={selectedFiles.includes(file.id)}
                            onToggleSelect={() => toggleSelect(file.id)}
                            onDelete={() => handleDelete(file.id)}
                            onRetrieval={() => handleRetrieval(file.id)}
                            onDownload={() => handleDownload(file.id)}
                            isDeleting={
                                deleteMutation.isPending &&
                                deleteMutation.variables?.id === file.id
                            }
                            isRetrieving={
                                retrievalMutation.isPending &&
                                retrievalMutation.variables?.fileId === file.id
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface FileItemProps {
    file: File;
    isSelected: boolean;
    onToggleSelect: () => void;
    onDelete: () => void;
    onRetrieval: () => void;
    onDownload: () => void;
    isDeleting: boolean;
    isRetrieving: boolean;
}

function FileRow({
    file,
    isSelected,
    onToggleSelect,
    onDelete,
    onRetrieval,
    onDownload,
    isDeleting,
    isRetrieving,
}: FileItemProps) {
    const status = deriveStatus(file);

    return (
        <TableRow>
            <TableCell>
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={onToggleSelect}
                    aria-label={`Select ${file.name}`}
                />
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                        <FileIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="font-medium">{file.name}</span>
                </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
                {formatBytes(file.size)}
            </TableCell>
            <TableCell className="text-muted-foreground">
                {formatDate(file.createdAt)}
            </TableCell>
            <TableCell>{getStatusBadge(status)}</TableCell>
            <TableCell>
                <FileActions
                    status={status}
                    onDelete={onDelete}
                    onRetrieval={onRetrieval}
                    onDownload={onDownload}
                    isDeleting={isDeleting}
                    isRetrieving={isRetrieving}
                />
            </TableCell>
        </TableRow>
    );
}

function FileCard({
    file,
    isSelected,
    onToggleSelect,
    onDelete,
    onRetrieval,
    onDownload,
    isDeleting,
    isRetrieving,
}: FileItemProps) {
    const status = deriveStatus(file);

    return (
        <Card className="group relative">
            <CardContent className="p-4">
                <div className="absolute right-2 top-2 flex items-center gap-1">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={onToggleSelect}
                        aria-label={`Select ${file.name}`}
                    />
                    <FileActions
                        status={status}
                        onDelete={onDelete}
                        onRetrieval={onRetrieval}
                        onDownload={onDownload}
                        isDeleting={isDeleting}
                        isRetrieving={isRetrieving}
                    />
                </div>
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                    <FileIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="mb-1 truncate font-medium">{file.name}</p>
                <p className="mb-2 text-sm text-muted-foreground">
                    {formatBytes(file.size)}
                </p>
                {getStatusBadge(status)}
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
                render={<Button variant="ghost" size="icon" />}
            >
                <MoreHorizontal className="h-4 w-4" />
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
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Clock className="mr-2 h-4 w-4" />
                            )}
                            Request retrieval
                        </DropdownMenuItem>
                    )}
                    {status === 'available' && (
                        <DropdownMenuItem onClick={onDownload}>
                            <Download className="mr-2 h-4 w-4" />
                            Download
                        </DropdownMenuItem>
                    )}
                    {status === 'retrieving' && (
                        <DropdownMenuItem disabled>
                            <RotateCw className="mr-2 h-4 w-4" />
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
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenuPositioner>
        </DropdownMenu>
    );
}

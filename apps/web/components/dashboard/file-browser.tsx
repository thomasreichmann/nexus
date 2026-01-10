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
} from 'lucide-react';
import { cn } from '@/lib/cn';

type FileStatus = 'archived' | 'retrieving' | 'available';

interface StoredFile {
    id: string;
    name: string;
    size: string;
    sizeBytes: number;
    uploadedAt: string;
    uploadedAtDate: Date;
    status: FileStatus;
}

const mockFiles: StoredFile[] = [
    {
        id: '1',
        name: 'vacation-photos-2024.zip',
        size: '4.2 GB',
        sizeBytes: 4509715660,
        uploadedAt: 'Jan 2, 2026',
        uploadedAtDate: new Date('2026-01-02'),
        status: 'archived',
    },
    {
        id: '2',
        name: 'project-backup.tar.gz',
        size: '12.8 GB',
        sizeBytes: 13743895347,
        uploadedAt: 'Jan 1, 2026',
        uploadedAtDate: new Date('2026-01-01'),
        status: 'archived',
    },
    {
        id: '3',
        name: 'raw-footage-jan.mov',
        size: '28.5 GB',
        sizeBytes: 30601641574,
        uploadedAt: 'Dec 30, 2025',
        uploadedAtDate: new Date('2025-12-30'),
        status: 'retrieving',
    },
    {
        id: '4',
        name: 'client-deliverables.zip',
        size: '1.3 GB',
        sizeBytes: 1395864371,
        uploadedAt: 'Dec 29, 2025',
        uploadedAtDate: new Date('2025-12-29'),
        status: 'available',
    },
    {
        id: '5',
        name: 'music-library-backup.zip',
        size: '8.7 GB',
        sizeBytes: 9341140172,
        uploadedAt: 'Dec 26, 2025',
        uploadedAtDate: new Date('2025-12-26'),
        status: 'archived',
    },
    {
        id: '6',
        name: 'design-assets-2023.zip',
        size: '2.1 GB',
        sizeBytes: 2254857830,
        uploadedAt: 'Dec 20, 2025',
        uploadedAtDate: new Date('2025-12-20'),
        status: 'archived',
    },
    {
        id: '7',
        name: 'old-projects.tar.gz',
        size: '5.4 GB',
        sizeBytes: 5798205850,
        uploadedAt: 'Dec 15, 2025',
        uploadedAtDate: new Date('2025-12-15'),
        status: 'archived',
    },
    {
        id: '8',
        name: 'family-videos-2022.zip',
        size: '15.2 GB',
        sizeBytes: 16322273689,
        uploadedAt: 'Dec 10, 2025',
        uploadedAtDate: new Date('2025-12-10'),
        status: 'archived',
    },
    {
        id: '9',
        name: 'website-backup-dec.tar.gz',
        size: '3.8 GB',
        sizeBytes: 4080218932,
        uploadedAt: 'Dec 5, 2025',
        uploadedAtDate: new Date('2025-12-05'),
        status: 'archived',
    },
    {
        id: '10',
        name: 'photo-archive-fall.zip',
        size: '6.9 GB',
        sizeBytes: 7407722905,
        uploadedAt: 'Nov 28, 2025',
        uploadedAtDate: new Date('2025-11-28'),
        status: 'archived',
    },
];

type SortKey = 'name' | 'size' | 'uploadedAt';
type SortOrder = 'asc' | 'desc';

export function FileBrowser() {
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>('uploadedAt');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const filteredFiles = mockFiles.filter((file) =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const sortedFiles = [...filteredFiles].sort((a, b) => {
        let comparison = 0;
        switch (sortKey) {
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'size':
                comparison = a.sizeBytes - b.sizeBytes;
                break;
            case 'uploadedAt':
                comparison =
                    a.uploadedAtDate.getTime() - b.uploadedAtDate.getTime();
                break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
    });

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

    const getStatusBadge = (status: FileStatus) => {
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
    };

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
                            <Button variant="outline" size="sm">
                                <RotateCw className="mr-2 h-4 w-4" />
                                Retrieve
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive bg-transparent"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                            </Button>
                        </div>
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
                                <TableRow key={file.id}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedFiles.includes(
                                                file.id
                                            )}
                                            onCheckedChange={() =>
                                                toggleSelect(file.id)
                                            }
                                            aria-label={`Select ${file.name}`}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                                                <FileIcon className="h-4 w-4 text-muted-foreground" />
                                            </div>
                                            <span className="font-medium">
                                                {file.name}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {file.size}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {file.uploadedAt}
                                    </TableCell>
                                    <TableCell>
                                        {getStatusBadge(file.status)}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                render={
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                    />
                                                }
                                            >
                                                <MoreHorizontal className="h-4 w-4" />
                                                <span className="sr-only">
                                                    Actions
                                                </span>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuPositioner align="end">
                                                <DropdownMenuContent>
                                                    {file.status ===
                                                        'archived' && (
                                                        <DropdownMenuItem>
                                                            <Clock className="mr-2 h-4 w-4" />
                                                            Request retrieval
                                                        </DropdownMenuItem>
                                                    )}
                                                    {file.status ===
                                                        'available' && (
                                                        <DropdownMenuItem>
                                                            <Download className="mr-2 h-4 w-4" />
                                                            Download
                                                        </DropdownMenuItem>
                                                    )}
                                                    {file.status ===
                                                        'retrieving' && (
                                                        <DropdownMenuItem
                                                            disabled
                                                        >
                                                            <RotateCw className="mr-2 h-4 w-4" />
                                                            Retrieving...
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem className="text-destructive focus:text-destructive">
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenuPositioner>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sortedFiles.map((file) => (
                        <Card key={file.id} className="group relative">
                            <CardContent className="p-4">
                                <div className="absolute right-2 top-2 flex items-center gap-1">
                                    <Checkbox
                                        checked={selectedFiles.includes(
                                            file.id
                                        )}
                                        onCheckedChange={() =>
                                            toggleSelect(file.id)
                                        }
                                        aria-label={`Select ${file.name}`}
                                    />
                                    <DropdownMenu>
                                        <DropdownMenuTrigger
                                            render={
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                />
                                            }
                                        >
                                            <MoreHorizontal className="h-4 w-4" />
                                            <span className="sr-only">
                                                Actions
                                            </span>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuPositioner align="end">
                                            <DropdownMenuContent>
                                                {file.status === 'archived' && (
                                                    <DropdownMenuItem>
                                                        <Clock className="mr-2 h-4 w-4" />
                                                        Request retrieval
                                                    </DropdownMenuItem>
                                                )}
                                                {file.status ===
                                                    'available' && (
                                                    <DropdownMenuItem>
                                                        <Download className="mr-2 h-4 w-4" />
                                                        Download
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="text-destructive focus:text-destructive">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenuPositioner>
                                    </DropdownMenu>
                                </div>
                                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                                    <FileIcon className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <p className="mb-1 truncate font-medium">
                                    {file.name}
                                </p>
                                <p className="mb-2 text-sm text-muted-foreground">
                                    {file.size}
                                </p>
                                {getStatusBadge(file.status)}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

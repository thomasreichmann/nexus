'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileIcon, ArrowRight, RotateCw, Archive } from 'lucide-react';
import type { Retrieval } from '@nexus/db/repo/retrievals';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/auth/client';
import { useTRPC } from '@/lib/trpc/client';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { StorageUsageBar } from '@/components/dashboard/StorageUsageBar';
import { StorageByType } from '@/components/dashboard/StorageByType';
import { UploadHistory } from '@/components/dashboard/UploadHistory';

function getRetrievalBadge(
    status: Retrieval['status'],
    tier: Retrieval['tier']
): string {
    if (status === 'ready') return 'Ready';
    return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export default function DashboardPage() {
    const trpc = useTRPC();
    const { data: session } = useSession();

    const { data: storageUsage, isLoading: isLoadingUsage } = useQuery(
        trpc.storage.getUsage.queryOptions()
    );
    const { data: filesData, isLoading: isLoadingFiles } = useQuery(
        trpc.files.list.queryOptions({ limit: 5 })
    );
    const { data: activeRetrievals, isLoading: isLoadingRetrievals } = useQuery(
        trpc.retrievals.listActive.queryOptions()
    );

    return (
        <div className="mx-auto max-w-7xl space-y-8">
            <div>
                <h1 className="text-2xl font-bold">
                    Welcome back
                    {session?.user?.name ? `, ${session.user.name}` : ''}
                </h1>
                <p className="text-muted-foreground">
                    Overview of your storage and recent activity
                </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Files Stored
                        </CardTitle>
                        <Archive className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {isLoadingUsage ? (
                            <Skeleton className="h-8 w-16" />
                        ) : (
                            <div className="text-2xl font-bold">
                                {storageUsage?.fileCount ?? 0}
                            </div>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                            files archived
                        </p>
                        <Link
                            href="/dashboard/files"
                            className="mt-2 inline-flex items-center text-xs text-primary hover:underline"
                        >
                            View all files
                            <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Retrievals
                        </CardTitle>
                        <RotateCw className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {isLoadingRetrievals ? (
                            <Skeleton className="h-8 w-10" />
                        ) : (
                            <div className="text-2xl font-bold">
                                {activeRetrievals?.length ?? 0}
                            </div>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                            active
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <StorageUsageBar />
                <StorageByType />
            </div>

            <UploadHistory />

            <div className="flex flex-col gap-6 lg:flex-row">
                <Card className="flex-1">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-base">
                                    Recent Uploads
                                </CardTitle>
                                <CardDescription>
                                    Your most recently archived files
                                </CardDescription>
                            </div>
                            <Link href="/dashboard/files">
                                <Button variant="outline" size="sm">
                                    View all
                                </Button>
                            </Link>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoadingFiles ? (
                            <div className="space-y-4">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-3"
                                    >
                                        <Skeleton className="h-8 w-8 rounded" />
                                        <div className="flex-1 space-y-1.5">
                                            <Skeleton className="h-4 w-40" />
                                            <Skeleton className="h-3 w-24" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : filesData?.files && filesData.files.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b text-left text-xs text-muted-foreground">
                                            <th className="pb-3 font-medium">
                                                Name
                                            </th>
                                            <th className="pb-3 font-medium">
                                                Size
                                            </th>
                                            <th className="pb-3 font-medium">
                                                Uploaded
                                            </th>
                                            <th className="pb-3 text-right font-medium">
                                                Status
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {filesData.files.map((file) => (
                                            <tr key={file.id} className="group">
                                                <td className="py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                                                            <FileIcon className="h-4 w-4 text-muted-foreground" />
                                                        </div>
                                                        <span className="truncate font-medium">
                                                            {file.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="py-3 text-sm text-muted-foreground">
                                                    {formatBytes(file.size)}
                                                </td>
                                                <td className="py-3 text-sm text-muted-foreground">
                                                    {formatRelativeTime(
                                                        file.createdAt
                                                    )}
                                                </td>
                                                <td className="py-3 text-right">
                                                    <Badge
                                                        variant="secondary"
                                                        className="capitalize"
                                                    >
                                                        {file.status}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No files uploaded yet
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="lg:w-80 lg:shrink-0">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <RotateCw className="h-4 w-4 text-primary" />
                                <CardTitle className="text-base">
                                    Retrievals
                                </CardTitle>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                                {activeRetrievals?.length ?? 0} active
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {isLoadingRetrievals ? (
                            <div className="space-y-3">
                                {Array.from({ length: 2 }).map((_, i) => (
                                    <Skeleton
                                        key={i}
                                        className="h-16 w-full rounded-lg"
                                    />
                                ))}
                            </div>
                        ) : activeRetrievals && activeRetrievals.length > 0 ? (
                            activeRetrievals.map((r) => (
                                <div
                                    key={r.id}
                                    className="rounded-lg border border-border bg-muted/50 p-3"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="truncate text-sm font-medium">
                                            {r.fileName}
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className="shrink-0 text-xs text-primary"
                                        >
                                            {getRetrievalBadge(
                                                r.status,
                                                r.tier
                                            )}
                                        </Badge>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{formatBytes(r.fileSize)}</span>
                                        <span>
                                            {formatRelativeTime(r.createdAt)}
                                        </span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No active retrievals
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

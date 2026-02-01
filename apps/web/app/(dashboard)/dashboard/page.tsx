'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { FileIcon, ArrowRight, RotateCw, Archive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useSession } from '@/lib/auth/client';
import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';

export default function DashboardPage() {
    const trpc = useTRPC();
    const { data: session } = useSession();

    const { data: stats } = useQuery(trpc.dashboard.getStats.queryOptions());
    const { data: recentUploads } = useQuery(
        trpc.dashboard.getRecentUploads.queryOptions()
    );
    const { data: retrievals } = useQuery(
        trpc.dashboard.getRetrievals.queryOptions()
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

            <div className="grid gap-6 sm:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Storage Used
                        </CardTitle>
                        <FileIcon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {stats?.storageUsedGb ?? '-'} GB
                        </div>
                        <Progress
                            value={stats?.storageUsedGb ?? 0}
                            className="mt-3 h-2"
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                            of {stats?.storageTotalGb ?? '-'} GB total
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Files Stored
                        </CardTitle>
                        <Archive className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {stats?.filesStored ?? '-'}
                        </div>
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
                        <div className="text-2xl font-bold">
                            {stats?.activeRetrievals ?? '-'}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            in progress
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            Next ready in ~2 hours
                        </p>
                    </CardContent>
                </Card>
            </div>

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
                                    {recentUploads?.map((file) => (
                                        <tr key={file.name} className="group">
                                            <td className="py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                                                        <FileIcon className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                    <span className="font-medium">
                                                        {file.name}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-3 text-sm text-muted-foreground">
                                                {file.size}
                                            </td>
                                            <td className="py-3 text-sm text-muted-foreground">
                                                {file.date}
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
                                {retrievals?.length ?? 0} active
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {retrievals && retrievals.length > 0 ? (
                            retrievals.map((file) => (
                                <div
                                    key={file.name}
                                    className="rounded-lg border border-border bg-muted/50 p-3"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="truncate text-sm font-medium">
                                            {file.name}
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className="shrink-0 text-xs text-primary"
                                        >
                                            {file.readyIn}
                                        </Badge>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{file.size}</span>
                                        <span>{file.requestedAt}</span>
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

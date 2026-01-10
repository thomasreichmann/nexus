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

const recentUploads = [
    {
        name: 'vacation-photos-2024.zip',
        size: '4.2 GB',
        date: '2 hours ago',
        status: 'archived',
    },
    {
        name: 'project-backup.tar.gz',
        size: '12.8 GB',
        date: '1 day ago',
        status: 'archived',
    },
    {
        name: 'raw-footage-jan.mov',
        size: '28.5 GB',
        date: '2 days ago',
        status: 'archived',
    },
    {
        name: 'client-deliverables.zip',
        size: '1.3 GB',
        date: '3 days ago',
        status: 'archived',
    },
    {
        name: 'music-library-backup.zip',
        size: '8.7 GB',
        date: '5 days ago',
        status: 'archived',
    },
];

const retrievals = [
    {
        name: 'design-assets-2023.zip',
        size: '2.1 GB',
        requestedAt: '3 hours ago',
        readyIn: '~2 hours',
    },
    {
        name: 'old-projects.tar.gz',
        size: '5.4 GB',
        requestedAt: '6 hours ago',
        readyIn: '~5 hours',
    },
];

export default function DashboardPage() {
    return (
        <div className="mx-auto max-w-7xl space-y-8">
            <div>
                <h1 className="text-2xl font-bold">Dashboard</h1>
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
                        <div className="text-2xl font-bold">34.2 GB</div>
                        <Progress value={34.2} className="mt-3 h-2" />
                        <p className="mt-2 text-xs text-muted-foreground">
                            of 100 GB total
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
                        <div className="text-2xl font-bold">127</div>
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
                            {retrievals.length}
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
                                    {recentUploads.map((file) => (
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
                                {retrievals.length} active
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {retrievals.length > 0 ? (
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

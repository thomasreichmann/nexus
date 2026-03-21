'use client';

import { useQuery } from '@tanstack/react-query';
import { PieChart } from 'lucide-react';
import { useTRPC } from '@/lib/trpc/client';
import { formatBytes } from '@/lib/format';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const CHART_COLORS = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
];

export function StorageByType() {
    const trpc = useTRPC();
    const { data, isLoading } = useQuery(trpc.storage.getByType.queryOptions());

    const maxBytes = data ? Math.max(...data.map((d) => d.totalBytes)) : 0;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                    <CardTitle className="text-base">Storage by Type</CardTitle>
                    <CardDescription>
                        Breakdown by file category
                    </CardDescription>
                </div>
                <PieChart className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="space-y-1.5">
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-2.5 w-full rounded-full" />
                            </div>
                        ))}
                    </div>
                ) : !data || data.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        No files uploaded yet
                    </div>
                ) : (
                    <div className="space-y-4">
                        {data.map((item, i) => {
                            const widthPct =
                                maxBytes > 0
                                    ? (item.totalBytes / maxBytes) * 100
                                    : 0;
                            const color = CHART_COLORS[i % CHART_COLORS.length];

                            return (
                                <div
                                    key={item.category}
                                    className="space-y-1.5"
                                >
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="h-3 w-3 rounded-sm"
                                                style={{
                                                    backgroundColor: color,
                                                }}
                                            />
                                            <span className="font-medium">
                                                {item.category}
                                            </span>
                                        </div>
                                        <span className="text-muted-foreground">
                                            {formatBytes(item.totalBytes)}{' '}
                                            &middot; {item.fileCount}{' '}
                                            {item.fileCount === 1
                                                ? 'file'
                                                : 'files'}
                                        </span>
                                    </div>
                                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full rounded-full transition-all"
                                            style={{
                                                width: `${widthPct}%`,
                                                backgroundColor: color,
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

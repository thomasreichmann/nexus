'use client';

import { useQuery } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import { useTRPC } from '@/lib/trpc/client';
import { formatBytes } from '@/lib/format';
import { Progress } from '@/components/ui/progress';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function getUsageLevel(percentage: number): {
    label: string;
    className: string;
} {
    if (percentage >= 90)
        return { label: 'Critical', className: 'text-destructive' };
    if (percentage >= 70) return { label: 'High', className: 'text-amber-500' };
    return { label: 'Normal', className: 'text-muted-foreground' };
}

export function StorageUsageBar() {
    const trpc = useTRPC();
    const { data, isLoading } = useQuery(trpc.storage.getUsage.queryOptions());

    const usage = data ? getUsageLevel(data.percentage) : null;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                    <CardTitle className="text-base">Storage Usage</CardTitle>
                    <CardDescription>
                        {data
                            ? `${formatBytes(data.usedBytes)} of ${formatBytes(data.quotaBytes)}`
                            : 'Loading usage data...'}
                    </CardDescription>
                </div>
                <HardDrive className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
                {isLoading || !data || !usage ? (
                    <>
                        <Skeleton className="h-3 w-full rounded-full" />
                        <Skeleton className="h-4 w-24" />
                    </>
                ) : (
                    <>
                        <Progress value={data.percentage} className="h-3" />
                        <div className="flex items-center justify-between text-sm">
                            <span className={usage.className}>
                                {data.percentage.toFixed(1)}% used &middot;{' '}
                                {usage.label}
                            </span>
                            <span className="text-muted-foreground capitalize">
                                {data.planTier} plan
                            </span>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

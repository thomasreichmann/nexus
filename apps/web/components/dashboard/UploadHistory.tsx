'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
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

function fillDateGaps(
    data: { date: string; totalBytes: number }[],
    days: number
): { date: string; totalBytes: number }[] {
    const filled: { date: string; totalBytes: number }[] = [];
    const dataMap = new Map(data.map((d) => [d.date, d.totalBytes]));
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        filled.push({ date: key, totalBytes: dataMap.get(key) ?? 0 });
    }

    return filled;
}

function formatDateLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function UploadHistory() {
    const trpc = useTRPC();
    const { data, isLoading } = useQuery(
        trpc.storage.getUploadHistory.queryOptions()
    );

    const chartData = useMemo(() => fillDateGaps(data ?? [], 30), [data]);

    const hasUploads = chartData.some((d) => d.totalBytes > 0);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                    <CardTitle className="text-base">Upload History</CardTitle>
                    <CardDescription>
                        Daily upload volume over the last 30 days
                    </CardDescription>
                </div>
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-[200px] w-full" />
                ) : !hasUploads ? (
                    <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                        No uploads in the last 30 days
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient
                                    id="uploadGradient"
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                >
                                    <stop
                                        offset="5%"
                                        stopColor="var(--chart-1)"
                                        stopOpacity={0.3}
                                    />
                                    <stop
                                        offset="95%"
                                        stopColor="var(--chart-1)"
                                        stopOpacity={0}
                                    />
                                </linearGradient>
                            </defs>
                            <CartesianGrid
                                strokeDasharray="3 3"
                                className="stroke-border"
                            />
                            <XAxis
                                dataKey="date"
                                tickFormatter={formatDateLabel}
                                tick={{ fontSize: 12 }}
                                className="fill-muted-foreground"
                                interval="preserveStartEnd"
                                tickMargin={8}
                            />
                            <YAxis
                                tickFormatter={(v: number) => formatBytes(v)}
                                tick={{ fontSize: 12 }}
                                className="fill-muted-foreground"
                                width={70}
                            />
                            <Tooltip
                                labelFormatter={(label) =>
                                    formatDateLabel(String(label))
                                }
                                formatter={(value) => [
                                    formatBytes(Number(value)),
                                    'Uploaded',
                                ]}
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--popover))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: 'var(--radius)',
                                    color: 'hsl(var(--popover-foreground))',
                                    fontSize: '0.875rem',
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey="totalBytes"
                                stroke="var(--chart-1)"
                                strokeWidth={2}
                                fill="url(#uploadGradient)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    );
}

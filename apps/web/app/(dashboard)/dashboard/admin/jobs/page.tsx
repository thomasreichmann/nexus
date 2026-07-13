'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatRelativeTimeCompact } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RotateCw } from 'lucide-react';
import type { Job } from '@nexus/db/repo/jobs';
import { TablePagination } from '@/components/ui/table-pagination';

type JobStatus = Job['status'];

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: JobStatus | undefined }[] = [
    { label: 'All', value: undefined },
    { label: 'Pending', value: 'pending' },
    { label: 'Processing', value: 'processing' },
    { label: 'Completed', value: 'completed' },
    { label: 'Failed', value: 'failed' },
];

export default function AdminJobsPage() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<JobStatus | undefined>();
    const [page, setPage] = useState(0);

    const listOptions = trpc.admin.jobs.list.queryOptions({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        status: statusFilter,
    });
    const countsOptions = trpc.admin.jobs.counts.queryOptions();

    const { data, isLoading, isFetching } = useQuery(listOptions);
    const { data: counts, isFetching: isCountsFetching } =
        useQuery(countsOptions);
    const isRefreshing = isFetching || isCountsFetching;

    const retryMutation = useMutation(
        trpc.admin.jobs.retry.mutationOptions({
            onSuccess() {
                queryClient.invalidateQueries({
                    queryKey: listOptions.queryKey,
                });
                queryClient.invalidateQueries({
                    queryKey: countsOptions.queryKey,
                });
            },
        })
    );

    function handleRefresh() {
        queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
        queryClient.invalidateQueries({ queryKey: countsOptions.queryKey });
    }

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Background Jobs</h1>
                <p className="text-muted-foreground">
                    Monitor and manage background job processing
                </p>
            </div>

            <StatusCounts counts={counts} />

            <div className="flex items-center gap-2">
                {STATUS_FILTERS.map((filter) => (
                    <Button
                        key={filter.label}
                        variant={
                            statusFilter === filter.value
                                ? 'default'
                                : 'outline'
                        }
                        size="sm"
                        onClick={() => {
                            setStatusFilter(filter.value);
                            setPage(0);
                        }}
                    >
                        {filter.label}
                    </Button>
                ))}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    title="Refresh"
                    className="ml-auto"
                >
                    <RotateCw
                        className={cn('size-4', isRefreshing && 'animate-spin')}
                    />
                </Button>
            </div>

            <Card>
                {isLoading ? (
                    <CardContent className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </CardContent>
                ) : !data?.jobs.length ? (
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <p className="text-muted-foreground">No jobs found</p>
                    </CardContent>
                ) : (
                    <>
                        {/* Below sm the 6-column table forces sideways
                            scrolling (same class as #311/#339), so it renders
                            as stacked rows: type full-width, metadata demoted
                            to a second line. */}
                        <ul className="divide-y sm:hidden">
                            {data.jobs.map((job) => (
                                <li
                                    key={job.id}
                                    className="flex items-center gap-3 px-4 py-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-mono text-sm font-medium">
                                            {job.type}
                                        </p>
                                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                            {formatRelativeTimeCompact(
                                                job.createdAt
                                            )}
                                            <span aria-hidden> · </span>
                                            {formatDuration(
                                                job.startedAt,
                                                job.completedAt
                                            )}
                                            <span aria-hidden> · </span>
                                            {job.attempts} attempt
                                            {job.attempts === 1 ? '' : 's'}
                                        </p>
                                    </div>
                                    <JobStatusBadge status={job.status} />
                                    {job.status === 'failed' && (
                                        <RetryJobButton
                                            onRetry={() =>
                                                retryMutation.mutate({
                                                    id: job.id,
                                                })
                                            }
                                            isRetrying={
                                                retryMutation.isPending &&
                                                retryMutation.variables?.id ===
                                                    job.id
                                            }
                                            disabled={retryMutation.isPending}
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                        <div className="hidden sm:block">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Created</TableHead>
                                        <TableHead>Duration</TableHead>
                                        <TableHead>Attempts</TableHead>
                                        <TableHead className="w-12" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.jobs.map((job) => (
                                        <TableRow key={job.id}>
                                            <TableCell className="font-medium font-mono text-sm">
                                                {job.type}
                                            </TableCell>
                                            <TableCell>
                                                <JobStatusBadge
                                                    status={job.status}
                                                />
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {formatDistanceToNow(
                                                    new Date(job.createdAt),
                                                    { addSuffix: true }
                                                )}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {formatDuration(
                                                    job.startedAt,
                                                    job.completedAt
                                                )}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {job.attempts}
                                            </TableCell>
                                            <TableCell>
                                                {job.status === 'failed' && (
                                                    <RetryJobButton
                                                        onRetry={() =>
                                                            retryMutation.mutate(
                                                                {
                                                                    id: job.id,
                                                                }
                                                            )
                                                        }
                                                        isRetrying={
                                                            retryMutation.isPending &&
                                                            retryMutation
                                                                .variables
                                                                ?.id === job.id
                                                        }
                                                        disabled={
                                                            retryMutation.isPending
                                                        }
                                                    />
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </Card>

            <TablePagination
                page={page}
                pageSize={PAGE_SIZE}
                total={data?.total ?? 0}
                onPageChange={setPage}
            />
        </div>
    );
}

function StatusCounts({ counts }: { counts?: Record<JobStatus, number> }) {
    const items = [
        {
            label: 'Pending',
            key: 'pending' as const,
            color: 'text-muted-foreground',
        },
        {
            label: 'Processing',
            key: 'processing' as const,
            color: 'text-blue-600',
        },
        {
            label: 'Completed',
            key: 'completed' as const,
            color: 'text-green-600',
        },
        { label: 'Failed', key: 'failed' as const, color: 'text-red-600' },
    ];

    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {items.map((item) => (
                <Card key={item.label}>
                    <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">
                            {item.label}
                        </p>
                        <p className={cn('text-2xl font-bold', item.color)}>
                            {counts ? counts[item.key] : '—'}
                        </p>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

interface RetryJobButtonProps {
    onRetry: () => void;
    /** This row's retry is in flight (spinner). */
    isRetrying: boolean;
    disabled: boolean;
}

/* Retry for failed jobs — shared by the table cell and the stacked mobile
   rows. */
function RetryJobButton({
    onRetry,
    isRetrying,
    disabled,
}: RetryJobButtonProps) {
    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={onRetry}
            disabled={disabled}
            title="Retry job"
            className="shrink-0"
        >
            {isRetrying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <RotateCw className="h-4 w-4" />
            )}
        </Button>
    );
}

function JobStatusBadge({ status }: { status: JobStatus }) {
    switch (status) {
        case 'pending':
            return (
                <Badge
                    variant="secondary"
                    className="bg-muted text-muted-foreground"
                >
                    Pending
                </Badge>
            );
        case 'processing':
            return (
                <Badge
                    variant="secondary"
                    className="bg-blue-500/10 text-blue-600"
                >
                    Processing
                </Badge>
            );
        case 'completed':
            return (
                <Badge
                    variant="secondary"
                    className="bg-green-500/10 text-green-600"
                >
                    Completed
                </Badge>
            );
        case 'failed':
            return (
                <Badge
                    variant="secondary"
                    className="bg-red-500/10 text-red-600"
                >
                    Failed
                </Badge>
            );
    }
}

function formatDuration(
    startedAt: Date | string | null,
    completedAt: Date | string | null
): string {
    if (!startedAt) return '—';
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const ms = end - start;

    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
}

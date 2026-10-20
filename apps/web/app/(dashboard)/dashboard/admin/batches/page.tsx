'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RotateCw } from 'lucide-react';
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
import { TablePagination } from '@/components/ui/table-pagination';
import { ResponsiveRows } from '@/components/ui/responsive-rows';
import { StackedList, StackedListRow } from '@/components/ui/stacked-list';
import type { PartialBatch } from '@nexus/db/repo/uploadBatches';

const PAGE_SIZE = 20;

/**
 * Every user's upload batches that came up short (#550): files their Upload
 * click sent that never finished, once the batch has gone quiet. The library
 * flags the same batches to their owners; this is where they show across
 * users, a wave that died included even when nothing of it landed.
 */
export default function AdminBatchesPage() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(0);

    const listOptions = trpc.admin.batches.partial.queryOptions({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
    });
    const { data, isLoading, isFetching } = useQuery(listOptions);

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Partial batches</h1>
                    <p className="text-muted-foreground">
                        Upload batches with files that never finished uploading
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                        queryClient.invalidateQueries({
                            queryKey: listOptions.queryKey,
                        })
                    }
                    disabled={isFetching}
                    title="Refresh"
                >
                    <RotateCw
                        className={cn('size-4', isFetching && 'animate-spin')}
                    />
                </Button>
            </div>

            <Card>
                <PartialBatchList
                    batches={data?.batches}
                    isLoading={isLoading}
                />
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

interface PartialBatchListProps {
    batches: PartialBatch[] | undefined;
    isLoading: boolean;
}

function PartialBatchList({ batches, isLoading }: PartialBatchListProps) {
    if (isLoading) {
        return (
            <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
        );
    }
    if (!batches?.length) {
        return (
            <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">No partial batches</p>
            </CardContent>
        );
    }
    return (
        <ResponsiveRows
            mobile={
                <StackedList>
                    {batches.map((batch) => (
                        <StackedListRow
                            key={batch.batchId}
                            className="px-4"
                            primary={
                                <p className="truncate text-sm font-medium">
                                    {batch.name}
                                </p>
                            }
                            meta={[
                                batch.userEmail,
                                formatRelativeTimeCompact(batch.createdAt),
                                `${batch.receivedFileCount} of ${batch.expectedFileCount} uploaded`,
                            ]}
                            trailing={
                                <MissingBadge count={batch.missingFileCount} />
                            }
                        />
                    ))}
                </StackedList>
            }
            desktop={
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Batch</TableHead>
                            <TableHead>User</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="text-right">
                                Expected
                            </TableHead>
                            <TableHead className="text-right">
                                Uploaded
                            </TableHead>
                            <TableHead className="text-right">
                                Missing
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {batches.map((batch) => (
                            <TableRow key={batch.batchId}>
                                <TableCell className="max-w-64 truncate font-medium">
                                    {batch.name}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    {batch.userEmail}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    {formatDistanceToNow(
                                        new Date(batch.createdAt),
                                        { addSuffix: true }
                                    )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {batch.expectedFileCount}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                    {batch.receivedFileCount}
                                </TableCell>
                                <TableCell className="text-right">
                                    <MissingBadge
                                        count={batch.missingFileCount}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            }
        />
    );
}

function MissingBadge({ count }: { count: number }) {
    return (
        <Badge
            variant="secondary"
            className="bg-amber-500/10 text-amber-600 tabular-nums"
        >
            {count} missing
        </Badge>
    );
}

'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PackageCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { getLivePollOptions } from '@/lib/trpc/polling';

interface ReadyDownloadsProps {
    /**
     * Whether the user has a restore under way. While they do, this list
     * follows the poll clock so the request that completes in the background
     * appears without a reload — the whole point of #426's live-refresh
     * criterion. The caller owns the answer because it is the one already
     * reading the in-flight rows.
     */
    isRestoreInFlight: boolean;
}

/**
 * Completed restores that can still be downloaded (#426).
 *
 * A sibling of the Retrievals card rather than a section of it: that one reads
 * the retrieval rows, which for a zip-delivered request lapse two days after
 * completion while the zip lives for seven. A restore that has finished stops
 * being "in flight" and starts being a download, and the two windows are
 * different lengths, so they are two lists.
 *
 * Renders nothing when there is nothing to download — an empty state here would
 * be a permanent fixture reporting the absence of a rare event. Nothing while
 * loading either, for the same reason: "no ready downloads" is the normal
 * answer, so a card-sized skeleton would flash on every dashboard visit to
 * announce a card that isn't coming.
 */
export function ReadyDownloads({ isRestoreInFlight }: ReadyDownloadsProps) {
    const trpc = useTRPC();
    const { data: requests } = useQuery(
        trpc.retrievals.listReady.queryOptions(
            undefined,
            getLivePollOptions(isRestoreInFlight)
        )
    );

    if (!requests || requests.length === 0) return null;

    return (
        <Card className="border-emerald-500/30">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <PackageCheck className="size-4 text-emerald-500" />
                        <CardTitle className="text-base">
                            Ready downloads
                        </CardTitle>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                        {requests.length} ready
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {requests.map((request) => (
                    <Link
                        key={request.requestId}
                        href={`/dashboard/files?request=${request.requestId}`}
                        className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3 transition-colors hover:bg-muted"
                    >
                        <div className="min-w-0 flex-1">
                            {/* "archives", the same word the panel this links
                                to uses — two spellings of one request's shape
                                across two surfaces of one feature reads as two
                                different things. */}
                            <p className="text-sm font-medium">
                                {request.fileCount} files ·{' '}
                                {formatBytes(request.totalBytes)}
                                {request.partCount > 1 &&
                                    ` · ${request.partCount} archives`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Downloadable until{' '}
                                {formatDate(request.expiresAt)}
                            </p>
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                ))}
            </CardContent>
        </Card>
    );
}

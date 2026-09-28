'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileIcon, ArrowRight, RotateCw, Archive } from 'lucide-react';
import { isProbablyCold } from '@nexus/db/objectState';
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
import { ResponsiveRows } from '@/components/ui/responsive-rows';
import { StackedList, StackedListRow } from '@/components/ui/stacked-list';
import { useSession } from '@/lib/auth/client';
import { useTRPC } from '@/lib/trpc/client';
import {
    formatBytes,
    formatDownloadWindow,
    formatRelativeTime,
    formatRelativeTimeCompact,
} from '@/lib/format';
import { getLivePollOptionsWhile } from '@/lib/trpc/polling';
import { MiddleTruncateName } from '@/components/dashboard/MiddleTruncateName';
import { StatusDot } from '@/components/dashboard/file-browser/SelectableIcon';
import {
    attachActiveRetrievals,
    deriveStatus,
    STATUS_LABELS,
} from '@/components/dashboard/file-browser/status';
import { ReadyDownloads } from '@/components/dashboard/ReadyDownloads';
import { StorageUsageBar } from '@/components/dashboard/StorageUsageBar';
import { StorageByType } from '@/components/dashboard/StorageByType';
import { UploadHistory } from '@/components/dashboard/UploadHistory';
import type {
    ActiveRetrievalWithFile,
    Retrieval,
} from '@nexus/db/repo/retrievals';

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
        trpc.retrievals.listActive.queryOptions(
            undefined,
            // Self-referential, so the card stops polling the moment its own
            // last row thaws rather than needing an outside signal (#426).
            getLivePollOptionsWhile(hasUnfinishedRestore)
        )
    );

    // Deliberately "any rows at all", not "any row still thawing": the zip
    // build only *starts* once every retrieval is `ready`, so a
    // still-thawing gate would switch this off at exactly the moment the
    // artifact the card is waiting for begins to exist. A `ready` row stays in
    // this list for its download window, which spans the build.
    const isRestoreInFlight = (activeRetrievals?.length ?? 0) > 0;

    // Same split, as user-facing counts (#413): a `ready` row is waiting on
    // the user, not on S3, so calling it "active" overstated the work left.
    const restoringCount =
        activeRetrievals?.filter(isStillRestoring).length ?? 0;
    const readyCount = (activeRetrievals?.length ?? 0) - restoringCount;
    const readySuffix =
        readyCount > 0
            ? ` · ${readyCount} ${STATUS_LABELS.available.toLowerCase()}`
            : '';

    // `files.list` carries no retrieval state, so status is derived by
    // pairing it with the retrieval list this page already polls — the same
    // `deriveStatus` input the file browser gets from its join (#358).
    const recentFiles = attachActiveRetrievals(
        filesData?.files ?? [],
        activeRetrievals ?? []
    );
    // Wait for both: rendering before the retrievals land would flash a
    // ready file as Archived.
    const isLoadingRecentFiles = isLoadingFiles || isLoadingRetrievals;

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

            {/* Above the fold, and above the stats: a finished restore is the
                one thing on this page that is waiting on the user. Renders
                nothing when there is nothing to download. */}
            <ReadyDownloads isRestoreInFlight={isRestoreInFlight} />

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
                            <ArrowRight className="ml-1 size-3" />
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
                                {restoringCount}
                            </div>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                            in progress{readySuffix}
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
                {/* gap-4: tighten Card's default gap-6 so the table header
                    sits closer to the card description. */}
                <Card className="min-w-0 flex-1 gap-4">
                    {/* The action pairs with the title row and the subtitle
                        owns the full width below — long copy (translations
                        run 20–30% longer) wraps under the button instead of
                        colliding with it. The subtitle nearly restates the
                        title, so below sm it yields its line — and the
                        header's row gap goes with it, or the empty second
                        grid row leaves a phantom 8px under the title. */}
                    <CardHeader className="gap-0 sm:gap-2">
                        <div className="flex items-center justify-between gap-4">
                            <CardTitle className="text-base">
                                Recent Uploads
                            </CardTitle>
                            <Link href="/dashboard/files" className="shrink-0">
                                <Button variant="outline" size="sm">
                                    View all
                                </Button>
                            </Link>
                        </div>
                        <CardDescription className="hidden sm:block">
                            Your most recently archived files
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoadingRecentFiles ? (
                            <div className="space-y-4">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-3"
                                    >
                                        <Skeleton className="h-8 w-8 rounded-sm" />
                                        <div className="flex-1 space-y-1.5">
                                            <Skeleton className="h-4 w-40" />
                                            <Skeleton className="h-3 w-24" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : recentFiles.length > 0 ? (
                            <ResponsiveRows
                                mobile={
                                    <StackedList>
                                        {recentFiles.map((file) => (
                                            <StackedListRow
                                                key={file.id}
                                                leading={
                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted">
                                                        <FileIcon className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                }
                                                primary={
                                                    <MiddleTruncateName
                                                        name={file.name}
                                                        className="font-medium"
                                                    />
                                                }
                                                meta={[
                                                    formatBytes(file.size),
                                                    formatRelativeTimeCompact(
                                                        file.createdAt
                                                    ),
                                                ]}
                                                trailing={
                                                    <StatusDot
                                                        status={deriveStatus(
                                                            file
                                                        )}
                                                        isCold={isProbablyCold(
                                                            file
                                                        )}
                                                    />
                                                }
                                            />
                                        ))}
                                    </StackedList>
                                }
                                desktop={
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b text-left text-xs text-muted-foreground">
                                                    <th className="pr-4 pb-3 font-medium">
                                                        Name
                                                    </th>
                                                    <th className="pr-4 pb-3 text-right font-medium">
                                                        Size
                                                    </th>
                                                    <th className="pr-4 pb-3 font-medium">
                                                        Uploaded
                                                    </th>
                                                    <th className="pb-3 text-right font-medium">
                                                        Status
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y">
                                                {recentFiles.map((file) => (
                                                    <tr
                                                        key={file.id}
                                                        className="group"
                                                    >
                                                        {/* w-full + max-w-0: the name
                                                    column absorbs leftover
                                                    width and its content
                                                    truncates instead of
                                                    growing the column to the
                                                    full string (#311). */}
                                                        <td className="w-full max-w-0 py-3 pr-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted">
                                                                    <FileIcon className="h-4 w-4 text-muted-foreground" />
                                                                </div>
                                                                <MiddleTruncateName
                                                                    name={
                                                                        file.name
                                                                    }
                                                                    className="flex-1 font-medium"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="py-3 pr-4 text-right text-sm whitespace-nowrap tabular-nums text-muted-foreground">
                                                            {formatBytes(
                                                                file.size
                                                            )}
                                                        </td>
                                                        <td className="py-3 pr-4 text-sm whitespace-nowrap text-muted-foreground">
                                                            {formatRelativeTime(
                                                                file.createdAt
                                                            )}
                                                        </td>
                                                        <td className="py-3 text-right whitespace-nowrap">
                                                            <StatusDot
                                                                status={deriveStatus(
                                                                    file
                                                                )}
                                                                isCold={isProbablyCold(
                                                                    file
                                                                )}
                                                            />
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                }
                            />
                        ) : (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No files uploaded yet
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="lg:w-80 lg:shrink-0">
                    <CardHeader className="pb-3">
                        {/* Terse badge copy: the card is w-80 at lg and Badge
                            is nowrap. flex-wrap is the backstop for longer
                            translations — the badge drops below the title
                            instead of overflowing the card. */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <RotateCw className="h-4 w-4 text-primary" />
                                <CardTitle className="text-base">
                                    Retrievals
                                </CardTitle>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                                {restoringCount} restoring
                                {readyCount > 0 && ` · ${readyCount} ready`}
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
                                            {formatDownloadWindow(
                                                r.status,
                                                r.expiresAt
                                            ) ??
                                                formatRelativeTime(r.createdAt)}
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

/**
 * Whether any row is still waiting on S3. `ready` rows stay in this list for
 * their download window, so "the list is non-empty" is not the same question.
 */
function hasUnfinishedRestore(
    retrievals: ActiveRetrievalWithFile[] | undefined
): boolean {
    return (retrievals ?? []).some(isStillRestoring);
}

function isStillRestoring(retrieval: ActiveRetrievalWithFile): boolean {
    return retrieval.status !== 'ready';
}

function getRetrievalBadge(
    status: Retrieval['status'],
    tier: Retrieval['tier']
): string {
    if (status === 'ready') return STATUS_LABELS.available;
    return tier.charAt(0).toUpperCase() + tier.slice(1);
}

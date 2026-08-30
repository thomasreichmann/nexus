'use client';

import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, PackageCheck, PackageOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes, formatDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { getLivePollOptionsWhile } from '@/lib/trpc/polling';

interface RetrievalDownloadsProps {
    /** The `?request=` deep link the ready email points at. */
    requestId: string;
}

/**
 * The payoff surface of a multi-file restore: the zip parts, and a way to get
 * them (#426).
 *
 * Reads `retrievals.readyRequest`, which is driven by the artifacts rather than
 * by the retrieval rows behind them — those lapse after two days while the zips
 * stay downloadable for seven, so anything joined through them would blank this
 * panel out for the last five days of a working download.
 */
export function RetrievalDownloads({ requestId }: RetrievalDownloadsProps) {
    const trpc = useTRPC();
    const {
        data: delivery,
        isLoading,
        isError,
    } = useQuery(
        trpc.retrievals.requestDelivery.queryOptions(
            { requestId },
            // Poll only while the zips are still being built. An expired
            // request will never change, and a ready one has nothing left to
            // wait for — polling either would be an interval that can never
            // end.
            getLivePollOptionsWhile(
                (delivery) => delivery?.state === 'building'
            )
        )
    );

    if (isLoading) {
        return <Skeleton className="h-40 w-full rounded-xl" />;
    }
    // A malformed id in the URL, a deleted request, or an outage. Separate from
    // the skeleton because `isLoading` is already false here — folding the two
    // together leaves a placeholder that never resolves.
    if (isError || !delivery) return <UnavailableCard />;
    // The email link outlives the download it points at, so both of these are
    // ordinary things to land on rather than errors.
    if (delivery.state === 'building') return <BuildingCard />;
    if (delivery.state === 'expired') return <ExpiredCard />;

    const { fileCount, partCount, totalBytes, expiresAt, artifacts } = delivery;

    return (
        <Card className="border-emerald-500/30 bg-emerald-500/[0.03]">
            <CardContent className="space-y-5 pt-6">
                <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                        <PackageCheck className="size-5 text-emerald-500" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold">
                            Your restore is ready
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {fileCount} files · {formatBytes(totalBytes)} ·{' '}
                            {partCount === 1
                                ? 'one archive'
                                : `${partCount} archives`}
                        </p>
                        {/* The artifact's clock, started at build time — not the
                            thawed originals', which lapse five days sooner. */}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Downloadable until {formatDate(expiresAt)}
                        </p>
                    </div>
                </div>

                {partCount > 1 && (
                    <p className="text-xs text-muted-foreground">
                        Your files are split across {partCount} archives —
                        download all of them to get the complete set.
                    </p>
                )}

                <ul className="space-y-2">
                    {artifacts.map((artifact, index) => (
                        <li
                            key={artifact.artifactId}
                            className="animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards"
                            style={{ animationDelay: `${index * 60}ms` }}
                        >
                            <ArtifactRow
                                artifactId={artifact.artifactId}
                                label={
                                    partCount === 1
                                        ? artifact.fileName
                                        : `Part ${artifact.part} of ${partCount}`
                                }
                                sizeBytes={artifact.sizeBytes}
                            />
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

interface ArtifactRowProps {
    artifactId: string;
    label: string;
    sizeBytes: number;
}

function ArtifactRow({ artifactId, label, sizeBytes }: ArtifactRowProps) {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    // fetchQuery rather than a mounted query: the presigned URL is minted by
    // the click, not held for one — it expires in an hour, and holding N of
    // them would sign every part the moment the panel renders. Same idiom as
    // the file browser's row download.
    async function handleDownload() {
        try {
            const { url } = await queryClient.fetchQuery(
                trpc.retrievals.artifactDownloadUrl.queryOptions({ artifactId })
            );
            window.open(url, '_blank');
        } catch {
            // Same copy as the file browser's row download — one failure, one
            // sentence, wherever the user hit it.
            toast.error('Failed to get download URL');
        }
    }

    return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                    {formatBytes(sizeBytes)}
                </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="size-4" />
                Download
            </Button>
        </div>
    );
}

function BuildingCard() {
    return (
        <StatusCard
            icon={
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
            }
            title="Your files are still being prepared"
        >
            {/* The honest included promise for the Bulk default (#406), not the
                "within 12 hours" the old copy claimed. */}
            Restoring from archive takes up to 48 hours. This page updates on
            its own, and we&apos;ll email you the moment the download is ready.
        </StatusCard>
    );
}

function UnavailableCard() {
    return (
        <StatusCard
            icon={<PackageOpen className="size-5 text-muted-foreground" />}
            title="We couldn't load this restore"
        >
            The link may be incomplete, or the restore may have been deleted.
            Your files are listed below either way.
        </StatusCard>
    );
}

function ExpiredCard() {
    return (
        <StatusCard
            icon={<PackageOpen className="size-5 text-muted-foreground" />}
            title="This download has expired"
        >
            Restored files stay downloadable for a limited time. Retrieve them
            again from your library below.
        </StatusCard>
    );
}

interface StatusCardProps {
    icon: ReactNode;
    title: string;
    children: ReactNode;
}

function StatusCard({ icon, title, children }: StatusCardProps) {
    return (
        <Card>
            <CardContent className="flex items-start gap-3 pt-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    {icon}
                </span>
                <div>
                    <h2 className="text-base font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{children}</p>
                </div>
            </CardContent>
        </Card>
    );
}

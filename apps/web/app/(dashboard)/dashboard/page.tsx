'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileIcon, ArrowRight, RotateCw, Archive } from 'lucide-react';
import type { Retrieval } from '@nexus/db/repo/retrievals';
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
import { useSession } from '@/lib/auth/client';
import { useTRPC } from '@/lib/trpc/client';
import {
    formatBytes,
    formatDownloadWindow,
    formatRelativeTime,
    formatRelativeTimeCompact,
} from '@/lib/format';
import { StorageUsageBar } from '@/components/dashboard/StorageUsageBar';
import { StorageByType } from '@/components/dashboard/StorageByType';
import { UploadHistory } from '@/components/dashboard/UploadHistory';

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
        trpc.retrievals.listActive.queryOptions()
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
                                {activeRetrievals?.length ?? 0}
                            </div>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                            active
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
                    <CardHeader>
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
                        {isLoadingFiles ? (
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
                        ) : filesData?.files && filesData.files.length > 0 ? (
                            <>
                                {/* Below sm a 4-column table can't give the
                                    name meaningful width, so the same data
                                    renders as stacked rows: name on its own
                                    line, metadata demoted to a second line.
                                    This list must precede the table in the
                                    DOM — the mobile-overflow spec asserts on
                                    getByText(...).first(), which has to hit
                                    the visible copy at 390px. */}
                                <ul className="divide-y sm:hidden">
                                    {filesData.files.map((file) => (
                                        <li
                                            key={file.id}
                                            className="flex items-center gap-3 py-3"
                                        >
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted">
                                                <FileIcon className="h-4 w-4 text-muted-foreground" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <MiddleTruncateName
                                                    name={file.name}
                                                />
                                                <div className="mt-0.5 flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
                                                    <span>
                                                        {formatBytes(file.size)}
                                                    </span>
                                                    <span aria-hidden>·</span>
                                                    <span>
                                                        {formatRelativeTimeCompact(
                                                            file.createdAt
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                            <MobileFileStatus
                                                status={file.status}
                                            />
                                        </li>
                                    ))}
                                </ul>
                                <div className="hidden overflow-x-auto sm:block">
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
                                            {filesData.files.map((file) => (
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
                                                                name={file.name}
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="py-3 pr-4 text-right text-sm whitespace-nowrap tabular-nums text-muted-foreground">
                                                        {formatBytes(file.size)}
                                                    </td>
                                                    <td className="py-3 pr-4 text-sm whitespace-nowrap text-muted-foreground">
                                                        {formatRelativeTime(
                                                            file.createdAt
                                                        )}
                                                    </td>
                                                    <td className="py-3 text-right whitespace-nowrap">
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
                            </>
                        ) : (
                            <div className="py-8 text-center text-sm text-muted-foreground">
                                No files uploaded yet
                            </div>
                        )}
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
                                {activeRetrievals?.length ?? 0} active
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

function getRetrievalBadge(
    status: Retrieval['status'],
    tier: Retrieval['tier']
): string {
    if (status === 'ready') return 'Ready';
    return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/* Tail length for middle truncation. Burst shots share a prefix and differ
   only in the trailing digits, and the extension (.dng vs .jpg) is real
   information — so the end of the name must survive truncation, not the
   start. 12 graphemes covers "<counter>.<ext>". */
const NAME_TAIL_GRAPHEMES = 12;

let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
    measureContext ??= document.createElement('canvas').getContext('2d');
    return measureContext;
}

/* Longest "head…tail" that fits the wrapper, measured with canvas
   measureText against the wrapper's computed font. Graphemes, not code
   units — filenames here carry emoji and CJK, and a blind slice() can shear
   a surrogate pair. */
function fitMiddleTruncatedName(wrapper: HTMLElement, name: string): string {
    const context = getMeasureContext();
    if (!context) return name;
    const style = getComputedStyle(wrapper);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // 1px slack for subpixel rounding; the wrapper's overflow-hidden clips
    // any residue.
    const available = wrapper.clientWidth - 1;
    if (context.measureText(name).width <= available) return name;
    const graphemes = Array.from(
        new Intl.Segmenter().segment(name),
        (segment) => segment.segment
    );
    const tail = graphemes.slice(-NAME_TAIL_GRAPHEMES).join('');
    const headGraphemes = graphemes.slice(0, -NAME_TAIL_GRAPHEMES);
    let low = 0;
    let high = headGraphemes.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidate = headGraphemes.slice(0, mid).join('') + '…' + tail;
        if (context.measureText(candidate).width <= available) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return headGraphemes.slice(0, low).join('') + '…' + tail;
}

interface MiddleTruncateNameProps {
    name: string;
}

/* Middle truncation has to be JS-measured: the CSS two-span trick leaves a
   hole at the seam, because text-overflow paints "…" after the last glyph
   that fully fits and the rest of the head's box stays blank. Rendering the
   fitted "head…tail" as one text run puts the ellipsis flush against the
   tail. The full name stays in the DOM (sr-only + title) for screen readers,
   hover, and the e2e specs that locate rows by full filename; the truncated
   copy is aria-hidden. flex-1 keeps the wrapper's width set by the layout,
   not its content, so refitting can't ratchet the available width down. */
function MiddleTruncateName({ name }: MiddleTruncateNameProps) {
    const wrapperRef = useRef<HTMLSpanElement>(null);
    const [display, setDisplay] = useState(name);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        let isActive = true;
        const fit = () => {
            if (isActive) {
                setDisplay(fitMiddleTruncatedName(wrapper, name));
            }
        };
        const observer = new ResizeObserver(fit);
        observer.observe(wrapper);
        fit();
        // A web-font swap changes glyph widths without resizing the wrapper.
        document.fonts.ready.then(fit, () => undefined);
        return () => {
            isActive = false;
            observer.disconnect();
        };
    }, [name]);

    return (
        <span
            ref={wrapperRef}
            className="block min-w-0 flex-1 overflow-hidden font-medium whitespace-nowrap"
            title={name}
        >
            <span className="sr-only">{name}</span>
            <span aria-hidden>{display}</span>
        </span>
    );
}

interface MobileFileStatusProps {
    status: string;
}

/* "Available" is the happy default — on mobile it earns a dot (with sr-only
   text; color is never the only channel), not a badge. Transitional states
   keep the text badge — those are the ones the user needs to notice — and
   restoring adds a glyph so it differs from the rest by more than hue. */
function MobileFileStatus({ status }: MobileFileStatusProps) {
    if (status === 'available') {
        return (
            <span
                className="size-2 shrink-0 self-center rounded-full bg-emerald-500"
                title="Available"
            >
                <span className="sr-only">Available</span>
            </span>
        );
    }
    return (
        <Badge variant="secondary" className="shrink-0 self-center capitalize">
            {status === 'restoring' && <RotateCw aria-hidden />}
            {status}
        </Badge>
    );
}

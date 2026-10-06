import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { getFileTypeInfo } from '@/components/dashboard/file-browser/status';
import type { FileWithRetrieval } from '@nexus/db/repo/files';
import type { BatchSummary } from './batchSummary';

interface BatchMosaicProps {
    batch: BatchSummary;
    thumbnailUrls: Record<string, string>;
    /** `cover` tops a library card; `thumb` is the 40px list-row version. */
    variant: 'cover' | 'thumb';
    children?: ReactNode;
}

/**
 * One tall photo and two stacked ones. Both variants carry the same three
 * `piece` slots in the same order: the open/close choreography flies each
 * piece between a card's cover and its row's thumbnail.
 */
export function BatchMosaic({
    batch,
    thumbnailUrls,
    variant,
    children,
}: BatchMosaicProps) {
    const isCover = variant === 'cover';
    return (
        <span
            data-fx={variant}
            className={cn(
                'relative grid grid-cols-[2fr_1fr] grid-rows-2',
                isCover
                    ? 'h-24 gap-0.5 sm:h-[140px]'
                    : 'size-10 shrink-0 gap-px overflow-hidden rounded-md'
            )}
        >
            {[0, 1, 2].map((slot) => (
                <MosaicPiece
                    key={slot}
                    file={batch.coverFiles[slot]}
                    thumbnailUrl={
                        batch.coverFiles[slot] &&
                        thumbnailUrls[batch.coverFiles[slot].id]
                    }
                    isThumb={!isCover}
                    className={slot === 0 ? 'row-span-2' : undefined}
                />
            ))}
            {children}
        </span>
    );
}

interface MosaicPieceProps {
    file: FileWithRetrieval | undefined;
    thumbnailUrl: string | undefined;
    isThumb: boolean;
    className?: string;
}

function MosaicPiece({
    file,
    thumbnailUrl,
    isThumb,
    className,
}: MosaicPieceProps) {
    if (!file) {
        return (
            <span data-fx="piece" className={cn('block bg-muted', className)} />
        );
    }
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(file.name);
    return (
        <span
            data-fx="piece"
            data-file-id={file.id}
            className={cn('relative block overflow-hidden bg-muted', className)}
        >
            <span
                className={cn(
                    'absolute inset-0 grid place-items-center',
                    colorClass
                )}
            >
                <TypeIcon
                    className={cn('opacity-60', isThumb ? 'size-3' : 'size-6')}
                    strokeWidth={1.5}
                />
            </span>
            {thumbnailUrl && (
                // Presigned S3 URL — see SelectableIcon for why not next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={thumbnailUrl}
                    alt=""
                    draggable={false}
                    decoding="async"
                    className="absolute inset-0 size-full object-cover"
                />
            )}
        </span>
    );
}

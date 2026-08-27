'use client';

import { useState } from 'react';
import { isProbablyCold } from '@nexus/db/objectState';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatBytes, formatDuration } from '@/lib/format';
import {
    deriveStatus,
    getDownloadWindowLabel,
    getFileExtension,
    getFileTypeInfo,
} from './status';
import { SelectableIcon, StatusDot } from './SelectableIcon';
import { FileActions, useFileActions } from './FileActions';
import { MiddleTruncateName } from '../MiddleTruncateName';
import type { FileItemProps } from './types';

export function FileCard({
    file,
    isSelected,
    isHighlighted,
    hasSelection,
    onSelect,
    thumbnailUrl,
    ref,
}: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    const isCold = isProbablyCold(file);
    const ext = getFileExtension(file.name);
    const downloadWindow = getDownloadWindowLabel(file);

    return (
        <Card
            ref={ref}
            className={cn(
                // min-w-0: grid items default to min-width:auto, so a long
                // unbreakable filename would widen the whole track (#311).
                'group relative min-w-0 cursor-pointer py-0 transition-all',
                isSelected
                    ? 'ring-2 ring-primary/30 bg-primary/2 dark:bg-primary/6'
                    : 'hover:border-border/80',
                isHighlighted && 'ring-2 ring-primary/40'
            )}
            onClick={(e) => onSelect(e.shiftKey)}
        >
            <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between">
                    <SelectableIcon
                        name={file.name}
                        checked={isSelected}
                        onCheckedChange={() => onSelect(false)}
                        showCheckbox={hasSelection}
                        size="md"
                    />
                    <div
                        className={cn(
                            'transition-opacity',
                            hasSelection
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-100 [&:has([data-state=open])]:opacity-100'
                        )}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <FileActions status={status} file={file} {...actions} />
                    </div>
                </div>
                <CardMedia
                    name={file.name}
                    thumbnailUrl={thumbnailUrl}
                    durationSeconds={file.durationSeconds}
                />
                <MiddleTruncateName
                    name={file.name}
                    className="text-sm/tight font-medium"
                />
                <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs tabular-nums text-muted-foreground">
                        {formatBytes(file.size)}
                        {ext && (
                            <>
                                <span className="mx-1 text-border">/</span>
                                <span className="uppercase">{ext}</span>
                            </>
                        )}
                    </span>
                    <div className="flex flex-col items-end gap-0.5">
                        <StatusDot status={status} isCold={isCold} />
                        {downloadWindow && (
                            <p className="text-xs text-muted-foreground">
                                {downloadWindow}
                            </p>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

/**
 * Fixed 4:3 media box: the space is reserved whether or not a thumbnail
 * exists (or has loaded yet), so the icon->image swap never reflows the
 * grid. Fallback is the file-type icon on its tint — the permanent state
 * for pending/failed/skipped thumbnails.
 */
function CardMedia({
    name,
    thumbnailUrl,
    durationSeconds,
}: {
    name: string;
    thumbnailUrl?: string;
    durationSeconds: number | null;
}) {
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(name);
    const [isLoaded, setIsLoaded] = useState(false);

    return (
        <div className="relative mb-3 aspect-4/3 min-w-0 overflow-hidden rounded-lg">
            <div
                className={cn(
                    'flex size-full items-center justify-center',
                    colorClass
                )}
            >
                <TypeIcon className="size-8 opacity-60" strokeWidth={1.5} />
            </div>
            {thumbnailUrl && (
                // Presigned S3 URL — see SelectableIcon for why not next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={thumbnailUrl}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setIsLoaded(true)}
                    className={cn(
                        'absolute inset-0 size-full object-cover transition-opacity duration-300',
                        isLoaded ? 'opacity-100' : 'opacity-0'
                    )}
                />
            )}
            {durationSeconds !== null && (
                <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                    {formatDuration(durationSeconds)}
                </span>
            )}
        </div>
    );
}

'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import {
    deriveStatus,
    getDownloadWindowLabel,
    getFileExtension,
} from './status';
import { SelectableIcon, StatusDot } from './SelectableIcon';
import { FileActions, useFileActions } from './FileActions';
import type { FileItemProps } from './types';

export function FileCard({
    file,
    isSelected,
    isHighlighted,
    hasSelection,
    onSelect,
}: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    const ext = getFileExtension(file.name);
    const downloadWindow = getDownloadWindowLabel(file);

    return (
        <Card
            data-file-id={file.id}
            className={cn(
                'group relative cursor-pointer py-0 transition-all',
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
                        <FileActions
                            status={status}
                            storageTier={file.storageTier}
                            {...actions}
                        />
                    </div>
                </div>
                <p className="truncate text-sm/tight font-medium">
                    {file.name}
                </p>
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
                        <StatusDot status={status} />
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

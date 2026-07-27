'use client';

import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate } from '@/lib/format';
import {
    deriveStatus,
    getDownloadWindowLabel,
    getFileExtension,
} from './status';
import { SelectableIcon, StatusDot } from './SelectableIcon';
import { FileActions, useFileActions } from './FileActions';
import { MiddleTruncateName } from '../MiddleTruncateName';
import type { FileItemProps } from './types';

export function FileRow({
    file,
    isSelected,
    isHighlighted,
    hasSelection,
    onSelect,
    ref,
}: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    const ext = getFileExtension(file.name);
    const downloadWindow = getDownloadWindowLabel(file);

    return (
        <TableRow
            ref={ref}
            data-state={isSelected ? 'selected' : undefined}
            className={cn(
                'cursor-pointer transition-colors',
                isSelected &&
                    'bg-primary/4 hover:bg-primary/6 dark:bg-primary/8 dark:hover:bg-primary/10',
                isHighlighted && 'bg-primary/10 dark:bg-primary/15'
            )}
            onClick={(e) => onSelect(e.shiftKey)}
        >
            <TableCell className="pl-4">
                <SelectableIcon
                    name={file.name}
                    checked={isSelected}
                    onCheckedChange={() => onSelect(false)}
                    showCheckbox={hasSelection}
                    size="sm"
                />
            </TableCell>
            {/* w-full + max-w-0: the name column absorbs leftover width and
                truncates instead of growing to the full string (#311). */}
            <TableCell className="w-full max-w-0">
                <div className="min-w-0">
                    <MiddleTruncateName
                        name={file.name}
                        className="font-medium leading-tight"
                    />
                    {ext && (
                        <p className="text-xs uppercase text-muted-foreground">
                            {ext}
                        </p>
                    )}
                </div>
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
                {formatBytes(file.size)}
            </TableCell>
            <TableCell className="text-muted-foreground">
                {formatDate(file.createdAt)}
            </TableCell>
            <TableCell>
                <StatusDot status={status} />
                {downloadWindow && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {downloadWindow}
                    </p>
                )}
            </TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
                <FileActions
                    status={status}
                    storageTier={file.storageTier}
                    {...actions}
                />
            </TableCell>
        </TableRow>
    );
}

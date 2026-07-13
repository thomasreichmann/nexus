'use client';

import { cn } from '@/lib/cn';
import { formatBytes, formatDate } from '@/lib/format';
import { deriveStatus, getDownloadWindowLabel } from './status';
import { SelectableIcon, StatusDot } from './SelectableIcon';
import { FileActions, useFileActions } from './FileActions';
import { MiddleTruncateName } from '../MiddleTruncateName';
import type { FileItemProps } from './types';

/* Below sm the 6-column table can't give the name meaningful width, so the
   list view renders these stacked rows instead (same treatment as the
   dashboard's Recent Uploads): name on its own line, metadata demoted to a
   second line, status demoted to a dot. Selection and actions keep the same
   entry points as FileRow — icon tap and the actions menu. */
export function MobileFileRow({
    file,
    isSelected,
    isHighlighted,
    hasSelection,
    onSelect,
    ref,
}: FileItemProps) {
    const status = deriveStatus(file);
    const actions = useFileActions(file);
    const downloadWindow = getDownloadWindowLabel(file);

    return (
        <li
            ref={ref}
            data-state={isSelected ? 'selected' : undefined}
            className={cn(
                'flex cursor-pointer items-center gap-3 px-2 py-3 transition-colors',
                isSelected && 'bg-primary/4 dark:bg-primary/8',
                isHighlighted && 'bg-primary/10 dark:bg-primary/15'
            )}
            onClick={(e) => onSelect(e.shiftKey)}
        >
            <SelectableIcon
                name={file.name}
                checked={isSelected}
                onCheckedChange={() => onSelect(false)}
                showCheckbox={hasSelection}
                size="sm"
            />
            <div className="min-w-0 flex-1">
                <MiddleTruncateName
                    name={file.name}
                    className="font-medium leading-tight"
                />
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    <span aria-hidden> · </span>
                    {formatDate(file.createdAt)}
                    {downloadWindow && (
                        <>
                            <span aria-hidden> · </span>
                            {downloadWindow}
                        </>
                    )}
                </p>
            </div>
            <StatusDot status={status} compact />
            <div onClick={(e) => e.stopPropagation()}>
                <FileActions
                    status={status}
                    storageTier={file.storageTier}
                    {...actions}
                />
            </div>
        </li>
    );
}

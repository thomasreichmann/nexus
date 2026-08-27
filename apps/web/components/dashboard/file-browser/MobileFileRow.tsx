'use client';

import { isProbablyCold } from '@nexus/db/objectState';
import { cn } from '@/lib/cn';
import { formatBytes, formatDate } from '@/lib/format';
import { StackedListRow } from '@/components/ui/stacked-list';
import { deriveStatus, getDownloadWindowLabel } from './status';
import { SelectableIcon, StatusDot } from './SelectableIcon';
import { FileActions, useFileActions } from './FileActions';
import { MiddleTruncateName } from '../MiddleTruncateName';
import type { FileItemProps } from './types';

/* Below sm the 6-column table can't give the name meaningful width, so the
   list view renders these stacked rows instead (the same StackedListRow
   anatomy as the dashboard's Recent Uploads): name on its own line, metadata
   demoted to a second line. Selection and actions keep the same entry points
   as FileRow — icon tap and the actions menu. */
export function MobileFileRow({
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
    const downloadWindow = getDownloadWindowLabel(file);

    return (
        <StackedListRow
            ref={ref}
            data-state={isSelected ? 'selected' : undefined}
            className={cn(
                'cursor-pointer px-2 transition-colors',
                isSelected && 'bg-primary/4 dark:bg-primary/8',
                isHighlighted && 'bg-primary/10 dark:bg-primary/15'
            )}
            onClick={(e) => onSelect(e.shiftKey)}
            leading={
                <SelectableIcon
                    name={file.name}
                    checked={isSelected}
                    onCheckedChange={() => onSelect(false)}
                    showCheckbox={hasSelection}
                    size="sm"
                    thumbnailUrl={thumbnailUrl}
                />
            }
            primary={
                <MiddleTruncateName
                    name={file.name}
                    className="font-medium leading-tight"
                />
            }
            meta={[
                formatBytes(file.size),
                formatDate(file.createdAt),
                downloadWindow,
            ]}
            trailing={
                <>
                    <StatusDot status={status} isCold={isCold} />
                    <div onClick={(e) => e.stopPropagation()}>
                        <FileActions status={status} file={file} {...actions} />
                    </div>
                </>
            }
        />
    );
}

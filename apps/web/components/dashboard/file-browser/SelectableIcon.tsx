'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { getFileTypeInfo, type DerivedStatus } from './status';

export function StatusDot({
    status,
    compact = false,
}: {
    status: DerivedStatus;
    /** Dot only, label demoted to sr-only — for width-starved mobile rows. */
    compact?: boolean;
}) {
    return (
        <span
            className="inline-flex items-center gap-1.5"
            title={compact ? status : undefined}
        >
            <span
                className={cn(
                    'relative inline-block size-2 rounded-full',
                    status === 'archived' && 'bg-muted-foreground/50',
                    status === 'retrieving' && 'bg-blue-500',
                    status === 'available' && 'bg-emerald-500'
                )}
            >
                {status === 'retrieving' && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/60" />
                )}
            </span>
            <span
                className={cn(
                    compact
                        ? 'sr-only'
                        : cn(
                              'text-xs capitalize',
                              status === 'archived' && 'text-muted-foreground',
                              status === 'retrieving' &&
                                  'text-blue-600 dark:text-blue-400',
                              status === 'available' &&
                                  'text-emerald-600 dark:text-emerald-400'
                          )
                )}
            >
                {status}
            </span>
        </span>
    );
}

/**
 * File icon that morphs into a checkbox on hover or when in selection mode.
 * Renders at a fixed size to prevent layout shift.
 */
export function SelectableIcon({
    name,
    checked,
    onCheckedChange,
    showCheckbox,
    size = 'sm',
}: {
    name: string;
    checked: boolean;
    onCheckedChange: () => void;
    showCheckbox: boolean;
    size?: 'sm' | 'md';
}) {
    const { icon: TypeIcon, colorClass } = getFileTypeInfo(name);
    const isSmall = size === 'sm';
    const containerClass = isSmall ? 'size-8' : 'size-10';
    const iconClass = isSmall ? 'size-4' : 'size-5';
    const reveal = checked || showCheckbox;

    return (
        <button
            type="button"
            className={cn(
                'group/icon relative flex shrink-0 items-center justify-center rounded-lg transition-colors',
                containerClass,
                reveal ? 'bg-primary/10' : colorClass
            )}
            onClick={(e) => {
                e.stopPropagation();
                onCheckedChange();
            }}
            aria-label={`Select ${name}`}
        >
            <TypeIcon
                className={cn(
                    iconClass,
                    'transition-opacity',
                    reveal
                        ? 'opacity-0'
                        : 'opacity-100 group-hover/icon:opacity-0'
                )}
            />
            <div
                className={cn(
                    'absolute inset-0 flex items-center justify-center transition-opacity',
                    reveal
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/icon:opacity-100'
                )}
            >
                <Checkbox
                    checked={checked}
                    tabIndex={-1}
                    onCheckedChange={onCheckedChange}
                    aria-hidden
                />
            </div>
        </button>
    );
}

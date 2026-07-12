import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Inline keyboard shortcut hint, e.g. <Kbd>⌘K</Kbd>
 */
export function Kbd({
    className,
    ...props
}: React.HTMLAttributes<HTMLElement>) {
    return (
        <kbd
            className={cn(
                'pointer-events-none inline-flex h-5 select-none items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground',
                className
            )}
            {...props}
        />
    );
}

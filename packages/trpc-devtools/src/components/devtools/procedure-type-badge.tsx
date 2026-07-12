import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ProcedureSchema } from '@/server/types';

/**
 * Compact single-letter procedure type indicator (Q/M/S), used wherever
 * procedures are listed (sidebar, history, command palette).
 */
export function ProcedureTypeBadge({
    type,
    className,
}: {
    type: ProcedureSchema['type'];
    className?: string;
}) {
    return (
        <Badge
            variant={type}
            className={cn('px-1.5 py-0 text-[10px]', className)}
        >
            {type.slice(0, 1).toUpperCase()}
        </Badge>
    );
}

'use client';

import { Snowflake } from 'lucide-react';
import { cn } from '@/lib/cn';
import { STATUS_LABELS, type DerivedStatus } from './status';

interface StatusDotProps {
    status: DerivedStatus;
    /** `isProbablyCold` for the file; adds the cold marker beside the dot. */
    isCold?: boolean;
}

/* The warm counterpart to ColdHint's label (#413): "Archived" alone covers
   both a file that restores in seconds and one that takes hours. Same hedge —
   it comes from the same `isProbablyCold` guess — but only a tooltip, since
   the warm case is the unremarkable one. */
const WARM_HINT = 'Probably still in warm storage — retrieval is usually quick';

export function StatusDot({ status, isCold }: StatusDotProps) {
    return (
        <span
            className="inline-flex shrink-0 items-center gap-1.5"
            title={status === 'archived' && !isCold ? WARM_HINT : undefined}
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
                    'text-xs',
                    status === 'archived' && 'text-muted-foreground',
                    status === 'retrieving' &&
                        'text-blue-600 dark:text-blue-400',
                    status === 'available' &&
                        'text-emerald-600 dark:text-emerald-400'
                )}
            >
                {STATUS_LABELS[status]}
            </span>
            {isCold && <ColdHint />}
        </span>
    );
}

/**
 * Marks a file the bucket's lifecycle policy has probably swept into Deep
 * Archive — derived from age and size, never from S3 (`isProbablyCold`).
 *
 * Deliberately the quietest thing in the row: a glyph, no text, no colour of
 * its own. It is the one signal on a row that is a guess rather than a fact,
 * so it must not compete with the ones that aren't. It reads differently from
 * the status dot beside it, too — the dot describes our records (is there an
 * active retrieval?), this describes where the bytes probably sit.
 */
interface ColdHintProps {
    className?: string;
}

function ColdHint({ className }: ColdHintProps) {
    const label = 'Probably in deep archive — retrieval takes hours';
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            className={cn('inline-flex text-muted-foreground/60', className)}
        >
            <Snowflake aria-hidden="true" className="size-3" />
        </span>
    );
}

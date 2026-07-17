import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* The `<ul>` that holds StackedListRow items — the mobile counterpart to a
   `<tbody>`. Kept separate so a caller can group rows (batch sections) or add
   padding without the row primitive knowing about it. */
export function StackedList({ className, ...props }: ComponentProps<'ul'>) {
    return <ul className={cn('divide-y', className)} {...props} />;
}

interface StackedListRowProps extends ComponentProps<'li'> {
    /** Leading slot: file icon, avatar, or a selection control. Omit for none. */
    leading?: ReactNode;
    /** Primary line — the row's title/name. */
    primary: ReactNode;
    /** Secondary metadata segments, joined with aria-hidden `·` separators.
        Falsy entries are dropped, so a conditional segment (an optional expiry,
        a download window) can't leave a dangling separator. */
    meta?: ReactNode[];
    /** Trailing slot: status, actions. Rendered as direct flex children, so a
        fragment of several nodes keeps the row's gap between them. */
    trailing?: ReactNode;
}

/* The mobile counterpart to a table row: an optional leading control, a
   min-w-0 title plus a truncated metadata line, and a trailing status/actions
   slot. The four responsive dashboard tables render their below-sm rows
   through this, so they can't drift on spacing, truncation, or the metadata
   separator. Extends the `<li>` props: a caller adds row padding, a click
   handler, a highlight class, or a focus ref without any of that leaking into
   the primitive. Anything richer than these four slots should be a bespoke
   `<li>`, not a new prop here. */
export function StackedListRow({
    leading,
    primary,
    meta,
    trailing,
    className,
    ...props
}: StackedListRowProps) {
    const segments = meta?.filter(Boolean) ?? [];
    return (
        <li
            className={cn('flex items-center gap-3 py-3', className)}
            {...props}
        >
            {leading}
            <div className="min-w-0 flex-1">
                {primary}
                {segments.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {segments.map((segment, i) => (
                            <Fragment key={i}>
                                {i > 0 && <span aria-hidden> · </span>}
                                {segment}
                            </Fragment>
                        ))}
                    </p>
                )}
            </div>
            {trailing}
        </li>
    );
}

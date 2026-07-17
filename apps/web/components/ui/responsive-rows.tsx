import type { ReactNode } from 'react';

interface ResponsiveRowsProps {
    /* Stacked-row copy, shown below `sm`. Rendered FIRST in the DOM: the e2e
       filename locators use `.first()` and must resolve to the visible copy at
       phone widths (390px). Both copies mount, so any per-row ref or effect
       fires twice — a focus/scroll effect must skip the display:none copy
       (see FileBrowser's focusRowRef `offsetParent === null` guard). */
    mobile: ReactNode;
    /* Real-table copy, shown at `sm` and up. */
    desktop: ReactNode;
}

/* Pairs a stacked mobile list with a desktop table under one breakpoint, so
   the `sm:hidden` / `hidden sm:block` split and the mobile-first DOM order it
   depends on live in one place instead of being hand-copied per table
   (a name-starved 6-column table below sm — #311/#339). Both halves render
   from the same data source; this only owns which one is visible. */
export function ResponsiveRows({ mobile, desktop }: ResponsiveRowsProps) {
    return (
        <>
            <div className="sm:hidden">{mobile}</div>
            <div className="hidden sm:block">{desktop}</div>
        </>
    );
}

'use client';

import * as React from 'react';

/** Tailwind `md` breakpoint — below this the devtools use the mobile layout. */
export const MOBILE_BREAKPOINT = 768;

/**
 * Track whether the viewport is below the mobile breakpoint.
 *
 * Defaults to `false` (desktop) until mounted so server rendering stays
 * deterministic; updates immediately after hydration and on viewport changes.
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = React.useState(false);

    React.useEffect(() => {
        const query = window.matchMedia(
            `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
        );

        const update = () => setIsMobile(query.matches);
        update();

        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    return isMobile;
}

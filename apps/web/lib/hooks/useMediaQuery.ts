'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept current as the viewport changes. The
 * server has no viewport, so it renders as `serverMatches` and the browser
 * corrects it right after hydration.
 */
export function useMediaQuery(query: string, serverMatches: boolean): boolean {
    const subscribe = useCallback(
        (onChange: () => void) => {
            const list = matchMedia(query);
            list.addEventListener('change', onChange);
            return () => list.removeEventListener('change', onChange);
        },
        [query]
    );
    return useSyncExternalStore(
        subscribe,
        () => matchMedia(query).matches,
        () => serverMatches
    );
}

/**
 * The open batch's grid/list choice, remembered across reloads (#408).
 *
 * A cookie rather than localStorage: the files page reads it on the server,
 * so a reload renders the remembered mode from the first paint instead of
 * showing the default and switching once the page hydrates. Per browser, like
 * any view preference; nothing about it belongs in the database.
 */

export type PaneViewMode = 'grid' | 'list';

export const VIEW_MODE_COOKIE = 'nexus-files-view';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Grid unless the cookie says list: anything else is a stale or edited value. */
export function parseViewMode(value: string | undefined): PaneViewMode {
    return value === 'list' ? 'list' : 'grid';
}

/**
 * The remembered mode as the browser has it now, or null on the server. Back
 * and Forward restore a page from the router's cache, server props and all,
 * so the page's own read can be older than the cookie.
 */
export function readRememberedViewMode(): PaneViewMode | null {
    if (typeof document === 'undefined') return null;
    const cookie = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith(`${VIEW_MODE_COOKIE}=`));
    if (cookie === undefined) return null;
    return parseViewMode(cookie.slice(VIEW_MODE_COOKIE.length + 1));
}

export function rememberViewMode(mode: PaneViewMode): void {
    document.cookie = `${VIEW_MODE_COOKIE}=${mode}; path=/dashboard/files; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

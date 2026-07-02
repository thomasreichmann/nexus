/** Where signed-in users land when no valid redirect target is supplied. */
export const DEFAULT_REDIRECT = '/dashboard';

/**
 * Validate a `redirect` query param before we navigate to it. Only same-origin
 * relative paths are honored — anything that could point off-site is dropped in
 * favor of {@link DEFAULT_REDIRECT}, closing the open-redirect hole an
 * attacker-supplied `?redirect=` would otherwise open.
 *
 * Rejected: absolute URLs (`https://evil.com`), protocol-relative (`//evil.com`)
 * and the backslash variant (`/\evil.com`, which some browsers treat as
 * protocol-relative), and anything not rooted at `/`.
 */
export function sanitizeRedirect(target: string | null | undefined): string {
    if (!target || !target.startsWith('/')) return DEFAULT_REDIRECT;
    if (target.startsWith('//') || target.startsWith('/\\')) {
        return DEFAULT_REDIRECT;
    }
    return target;
}

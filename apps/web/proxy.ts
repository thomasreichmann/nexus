import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { sanitizeRedirect } from '@/lib/auth/sanitizeRedirect';

const AUTH_ROUTES = ['/sign-in', '/sign-up'];

/**
 * Optimistic auth guard (UX layer only). It reads the session cookie's
 * presence — no DB hit — to keep signed-out users out of the dashboard shell
 * and signed-in users out of the auth pages. Real enforcement stays in tRPC's
 * `protectedProcedure`; a forged cookie gets past here but sees an empty shell
 * and 401s. See docs/ai/conventions.md § Auth Enforcement.
 */
export function proxy(req: NextRequest): NextResponse {
    const { nextUrl } = req;
    const { pathname } = nextUrl;
    const hasSession = Boolean(getSessionCookie(req));

    // Signed-out visitor to a dashboard route → sign-in, preserving the full
    // path+query so email deep-links (e.g. ?file=<id>) survive the round trip.
    if (!hasSession && pathname.startsWith('/dashboard')) {
        const signInUrl = new URL('/sign-in', req.url);
        signInUrl.searchParams.set('redirect', pathname + nextUrl.search);
        return NextResponse.redirect(signInUrl);
    }

    // Signed-in visitor to an auth page → forward to their redirect target
    // (sanitized) or the dashboard, so they never see a stale sign-in form.
    if (hasSession && AUTH_ROUTES.includes(pathname)) {
        const target = sanitizeRedirect(nextUrl.searchParams.get('redirect'));
        return NextResponse.redirect(new URL(target, req.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/dashboard/:path*', '/sign-in', '/sign-up'],
};

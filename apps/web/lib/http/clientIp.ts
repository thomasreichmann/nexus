/**
 * The caller's IP address, for rate limiting anonymous requests.
 *
 * `x-forwarded-for` is only as trustworthy as whatever set it. Vercel
 * overwrites the header with the address it saw, so on a deployment the first
 * entry is the client and can't be forged. Anywhere else (local dev, a
 * production build under e2e) nothing sets it, and a caller can send its own.
 */
export function getClientIp(headers: Headers): string | undefined {
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || headers.get('x-real-ip') || undefined;
}

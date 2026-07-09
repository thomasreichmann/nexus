/**
 * Runtime environment detection.
 *
 * `VERCEL_ENV` is the canonical signal for *where* the code is running: Vercel
 * sets it to `'production' | 'preview' | 'development'` on every deployment and
 * leaves it unset for local `pnpm dev`. `NODE_ENV` only distinguishes a dev
 * build from a production build, and Next.js forces it to `'production'` for
 * every deployed build — so it cannot, on its own, tell a preview apart from
 * prod or a deployment apart from a laptop.
 */

/**
 * The environment name to attribute runtime behaviour to. Prefers the platform
 * signal (`VERCEL_ENV`) and falls back to `NODE_ENV` off-Vercel (local dev, CI,
 * tests) so the value is always meaningful.
 */
export function resolveRuntimeEnvironment(): string {
    return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';
}

/**
 * True only on a developer's machine (`pnpm dev`): `NODE_ENV` is `'development'`
 * AND we are not on any Vercel deployment. Every deployed environment — preview
 * and production alike — returns `false`, even if `NODE_ENV` were somehow set to
 * `'development'`, because `VERCEL_ENV` is present.
 *
 * Security-sensitive bypasses (e.g. skipping webhook signature verification)
 * gate on this rather than on `NODE_ENV` alone, so a misconfigured `NODE_ENV`
 * on a deployment can never open the bypass.
 */
export function isLocalDevelopment(): boolean {
    return (
        process.env.NODE_ENV === 'development' &&
        process.env.VERCEL_ENV === undefined
    );
}

import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import path from 'node:path';
import {
    DEFAULT_POSTHOG_HOST,
    POSTHOG_INGEST_PATH,
    resolveAssetsHost,
} from './lib/posthog/hosts';

const posthogHost =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;

const nextConfig: NextConfig = {
    // Suppress verbose request logging in dev - we have our own tRPC logging
    logging: false,
    // @nexus/db exports raw TypeScript (JIT compilation, no build step)
    transpilePackages: ['@nexus/db'],
    // PostHog's ingestion paths end in a slash (/e/, /s/). Next normalizes
    // trailing slashes with a 308 *before* rewrites run, so without this the
    // proxied requests below get redirected instead of proxied.
    //
    // This setting is app-wide, not scoped to /ingest: every route now serves
    // `/some/page/` directly instead of redirecting it to `/some/page`. That
    // costs the canonical-URL redirect on all pages, which is the price of
    // the proxy below.
    skipTrailingSlashRedirect: true,
    // First-party reverse proxy for PostHog (see lib/posthog/hosts.ts for why).
    //
    // Rewrites forward the incoming headers, so these requests carry the
    // better-auth session cookie to PostHog. Accepted deliberately: it's
    // PostHog's own documented Next.js setup, they have no use for the cookie,
    // and the alternative (a hand-rolled route-handler proxy that strips
    // Cookie) is more moving parts than the exposure warrants. Revisit if the
    // cohort ever grows past known testers.
    async rewrites() {
        return [
            {
                source: `${POSTHOG_INGEST_PATH}/static/:path*`,
                destination: `${resolveAssetsHost(posthogHost)}/static/:path*`,
            },
            {
                source: `${POSTHOG_INGEST_PATH}/:path*`,
                destination: `${posthogHost}/:path*`,
            },
        ];
    },
    // Pin the workspace root. Git worktrees carry their own pnpm-lock.yaml,
    // so Next's lockfile inference finds two candidates (worktree + primary
    // checkout), picks the wrong one, and warns on every build.
    turbopack: {
        root: path.join(__dirname, '../..'),
    },
};

export default withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    // Only Vercel builds hold SENTRY_AUTH_TOKEN. Disabling stops tokenless
    // builds (local, CI, e2e) from generating source maps and injecting
    // debug IDs at all — not just from uploading.
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    // Turbopack builds run Sentry's after-compile hook on every production
    // build — there is no webpack plugin to omit — and off-Vercel it warns
    // about the missing auth token. `silent` is what keeps local/CI build
    // output clean; on Vercel it stays off so the sentry-cli upload report
    // lands in the build log.
    silent: !process.env.VERCEL,
    telemetry: false,
    // webpack-only options (widenClientFileUpload, disableLogger) are
    // deliberately absent: Next 16 builds with Turbopack, where they are
    // no-ops — Turbopack uploads the full client bundle unconditionally.
});

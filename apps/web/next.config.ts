import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
    // Suppress verbose request logging in dev - we have our own tRPC logging
    logging: false,
    // @nexus/db exports raw TypeScript (JIT compilation, no build step)
    transpilePackages: ['@nexus/db'],
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

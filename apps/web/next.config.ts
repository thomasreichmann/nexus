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
    // Only Vercel builds hold SENTRY_AUTH_TOKEN; disabling upload explicitly
    // keeps local/CI builds from warning about a missing token on every run.
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    // Upload logs are useful in Vercel build output; everywhere else the
    // plugin is inert, so keep it quiet.
    silent: !process.env.VERCEL,
    // Upload the full client bundle so prod stack traces resolve through
    // framework/vendor frames, not just app code.
    widenClientFileUpload: true,
    // Strip Sentry SDK debug-logger code from the client bundle.
    disableLogger: true,
    telemetry: false,
});

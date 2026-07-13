import * as Sentry from '@sentry/nextjs';

// Same double gate as sentry.server.config.ts, client-flavored: the DSN
// exists only in Vercel's production/preview env tiers (see
// ASYMMETRY_ALLOWLIST in scripts/check-vercel-env-parity.ts), and
// NEXT_PUBLIC_VERCEL_ENV — inlined on every deployment because the project
// auto-exposes system env vars; `process.env.VERCEL` isn't NEXT_PUBLIC_-
// prefixed so it can't gate here — keeps a stray .env.local DSN from turning
// Sentry on in local dev, CI, and the e2e production builds, which assert
// zero console errors. Raw process.env (not `@/lib/env`) is deliberate too:
// the env proxy reads process.env[key] dynamically, which the bundler can't
// inline into browser code — only literal process.env.NEXT_PUBLIC_*
// expressions survive client bundling.
if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        // Mirrors resolveRuntimeEnvironment(), which reads server-only vars
        // and can't run in the browser: the Vercel tier when system env vars
        // are exposed, else the build type.
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
        // Tracing is out of scope for #327 — errors and replay only.
        tracesSampleRate: 0,
        // Replay on-error only: the free plan has 50 replays/mo.
        // Masking/blocking off: replays exist to debug alpha testers'
        // sessions, so visibility beats redaction — it's our own known
        // testers, and the SDK keeps masking password inputs regardless.
        integrations: [
            Sentry.replayIntegration({
                maskAllText: false,
                maskAllInputs: false,
                blockAllMedia: false,
            }),
        ],
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,
    });
}

// Inert while tracing is off; wired now so navigation instrumentation works
// the day a sample rate is set.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

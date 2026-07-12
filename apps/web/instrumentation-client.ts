import * as Sentry from '@sentry/nextjs';

// DSN presence is the deployment gate on the client: the DSN exists only in
// Vercel's production/preview env tiers (see ASYMMETRY_ALLOWLIST in
// scripts/check-vercel-env-parity.ts), so local dev, CI, and the e2e
// production builds — which assert zero console errors — never initialize
// Sentry. `process.env.VERCEL` can't gate here: it isn't NEXT_PUBLIC_-
// prefixed, so it is never inlined into the client bundle.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
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

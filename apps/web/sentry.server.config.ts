import * as Sentry from '@sentry/nextjs';

import { resolveRuntimeEnvironment } from '@/lib/env/runtime';

// Same deployment gate as Vercel Analytics (app/layout.tsx): off-Vercel
// production builds (CI, e2e) must never send events. The DSN check alone
// would do today — the DSN only exists in Vercel env tiers (see
// ASYMMETRY_ALLOWLIST in scripts/check-vercel-env-parity.ts) — but the
// VERCEL check keeps a stray .env.local DSN from turning Sentry on locally.
if (process.env.VERCEL && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: resolveRuntimeEnvironment(),
        // Tracing is out of scope for #327 — errors only.
        tracesSampleRate: 0,
    });
}

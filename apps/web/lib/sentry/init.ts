import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import { resolveRuntimeEnvironment } from '@/lib/env/runtime';

/**
 * Shared by the node and edge Sentry entry files — Next.js requires them to
 * be separate modules, but the init itself is runtime-agnostic.
 *
 * Same deployment gate as Vercel Analytics (app/layout.tsx): off-Vercel
 * production builds (CI, e2e) must never send events. The DSN check alone
 * would do today — the DSN only exists in Vercel env tiers (see
 * ASYMMETRY_ALLOWLIST in scripts/check-vercel-env-parity.ts) — but the
 * VERCEL check keeps a stray .env.local DSN from turning Sentry on locally.
 */
export function initServerSentry(): void {
    if (process.env.VERCEL && env.NEXT_PUBLIC_SENTRY_DSN) {
        Sentry.init({
            dsn: env.NEXT_PUBLIC_SENTRY_DSN,
            environment: resolveRuntimeEnvironment(),
            // Tracing is out of scope for #327 — errors only.
            tracesSampleRate: 0,
        });
    }
}

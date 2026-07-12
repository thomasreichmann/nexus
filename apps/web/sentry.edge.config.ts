import * as Sentry from '@sentry/nextjs';

import { resolveRuntimeEnvironment } from '@/lib/env/runtime';

// Covers the edge runtime (proxy.ts). Same gate as sentry.server.config.ts.
if (process.env.VERCEL && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: resolveRuntimeEnvironment(),
        // Tracing is out of scope for #327 — errors only.
        tracesSampleRate: 0,
    });
}

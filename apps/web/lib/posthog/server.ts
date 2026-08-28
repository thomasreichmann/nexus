/**
 * The app's binding of `@nexus/analytics` — server-side counterpart to
 * lib/posthog/client.ts, for the two events the browser can't vouch for: an
 * upload the server actually committed, and a Glacier restore that completes
 * hours later with no session attached.
 *
 * Capture itself lives in the package because the worker Lambda emits the same
 * events and cannot import from the app (#425). What stays here is what only
 * Next can supply: `after` to keep the function alive for posthog-node's
 * batched flush (a Vercel function can be frozen the instant it responds), and
 * the Vercel tier as the `environment` property.
 *
 * Raw process.env for the two PostHog keys rather than `@/lib/env`: that
 * module validates the whole client schema at import time, so pulling it into
 * a service's dependency graph makes every unit test of that service require a
 * full .env.local. The clientSchema entries still validate these two vars
 * wherever the app does load `@/lib/env`. `@/lib/env/runtime` is exempt and
 * safe to import — it has no imports of its own and reads process.env
 * directly, so it drags no schema validation behind it.
 */
import { after } from 'next/server';
import { createServerAnalytics } from '@nexus/analytics/server';

import { resolveRuntimeEnvironment } from '@/lib/env/runtime';

import { DEFAULT_POSTHOG_HOST } from './hosts';

import type { ServerAnalytics } from '@nexus/analytics/server';
import type { PostHogEventName } from './events';

let analytics: ServerAnalytics | undefined;

function getAnalytics(): ServerAnalytics {
    analytics ??= createServerAnalytics({
        key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
        environment: resolveRuntimeEnvironment(),
        // posthog-node batches, and a Vercel function can be frozen the
        // instant it responds — without this the batch is dropped unsent.
        // `after` keeps the invocation alive until the flush lands.
        waitUntil: (promise) => {
            try {
                after(promise);
            } catch {
                // Outside a Next request scope (scripts, tests). Nothing to
                // extend, so fall back to the SDK's own interval flush.
            }
        },
    });
    return analytics;
}

/**
 * Fire-and-forget. Analytics is never allowed to fail a real request, so a
 * broken client degrades to a log line inside the package.
 */
export function captureServerEvent(
    userId: string,
    event: PostHogEventName,
    properties?: Record<string, unknown>
): void {
    getAnalytics().captureEvent(userId, event, properties);
}

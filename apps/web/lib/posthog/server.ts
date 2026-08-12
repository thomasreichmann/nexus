import { after } from 'next/server';
import { PostHog } from 'posthog-node';

import { resolveRuntimeEnvironment } from '@/lib/env/runtime';

import { DEFAULT_POSTHOG_HOST } from './hosts';
import { ANALYTICS_ENVIRONMENT_PROPERTY } from './events';
import type { PostHogEventName } from './events';

/**
 * Server-side counterpart to lib/posthog/client.ts, for the two events the
 * browser can't vouch for: an upload the server actually committed, and a
 * Glacier restore that completes hours later in an SNS webhook with no session
 * attached.
 *
 * Gating mirrors lib/sentry/init.ts rather than lib/stripe/client.ts: the key
 * is optional (deployed Vercel tiers only), so an unconditional constructor
 * would blow up in local dev, CI, and unit tests. `process.env.VERCEL` is fine
 * here where instrumentation-client.ts needs NEXT_PUBLIC_VERCEL_ENV — this
 * module never reaches the browser bundle.
 *
 * Raw process.env for the two keys rather than `@/lib/env` for a different
 * reason than the browser has: that module validates the whole client schema
 * at import time, so pulling it into a service's dependency graph makes every
 * unit test of that service require a full .env.local. The clientSchema
 * entries still validate these two vars wherever the app does load
 * `@/lib/env`. `@/lib/env/runtime` is exempt and safe to import — it has no
 * imports of its own and reads process.env directly, so it drags no schema
 * validation behind it.
 */
function createClient(): PostHog | null {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!process.env.VERCEL || !key) return null;

    return new PostHog(key, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
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
}

// Lazy so a build-time import doesn't open a client, and so tests that never
// capture never construct one.
let client: PostHog | null | undefined;

function getClient(): PostHog | null {
    if (client === undefined) client = createClient();
    return client;
}

/**
 * Fire-and-forget. Analytics is never allowed to fail a real request, so a
 * broken client degrades to a log line.
 *
 * console rather than server/lib/logger for the same reason as the env read
 * above: the logger imports `@/lib/env`, and dragging that into a service's
 * dependency graph makes the service's unit tests demand a full .env.local.
 * Vercel collects both the same way. lib/env/index.ts has the precedent.
 */
export function captureServerEvent(
    userId: string,
    event: PostHogEventName,
    properties?: Record<string, unknown>
): void {
    const posthog = getClient();
    if (!posthog) return;

    try {
        posthog.capture({
            distinctId: userId,
            event,
            // Spread first so a caller can't accidentally shadow the tier.
            properties: {
                ...properties,
                [ANALYTICS_ENVIRONMENT_PROPERTY]: resolveRuntimeEnvironment(),
            },
        });
    } catch (error) {
        console.warn(`PostHog capture failed for "${event}":`, error);
    }
}

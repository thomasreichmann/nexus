import { PostHog } from 'posthog-node';

import { ANALYTICS_ENVIRONMENT_PROPERTY } from './events';

import type { PostHogEventName } from './events';

/**
 * Server-side PostHog capture, for the events a browser can't vouch for: an
 * upload the server actually committed, and a Glacier restore that completes
 * hours later with no session attached.
 *
 * It lives in a package rather than in apps/web for two reasons. The worker
 * cannot import from the app at all (the @nexus/db precedent, #364), and the
 * app's own module was bound to Next regardless — it flushes through
 * `next/server`'s `after`, which doesn't exist outside a Next request scope.
 * Everything that differs per runtime is injected (`enabled`, `key`, `host`,
 * `environment`, `waitUntil`) so the gate, the shared `environment` property,
 * and the never-throw contract have exactly one implementation.
 */
export interface ServerAnalyticsOptions {
    /**
     * Master switch. Defaults to {@link isServerAnalyticsEnabled}, so a new
     * runtime that forgets it gets the shared gate rather than silent-off.
     * Pass it only to override — tests do.
     */
    enabled?: boolean;
    /** PostHog project key. Absent disables capture, same as `enabled: false`. */
    key: string | undefined;
    /** PostHog ingestion host, e.g. `https://us.i.posthog.com`. */
    host: string;
    /** Value reported as {@link ANALYTICS_ENVIRONMENT_PROPERTY} on every event. */
    environment: string;
    /**
     * Keeps the runtime alive until posthog-node's batched flush lands. A
     * Vercel function can be frozen the instant it responds, and Lambda
     * freezes the instant the handler resolves — without this the batch is
     * dropped unsent. Omit only where the process outlives the work.
     */
    waitUntil?: (promise: Promise<unknown>) => void;
}

export interface ServerAnalytics {
    /**
     * Fire-and-forget. Analytics is never allowed to fail real work, so a
     * broken client degrades to a log line.
     */
    captureEvent(
        userId: string,
        event: PostHogEventName,
        properties?: Record<string, unknown>
    ): void;
    /**
     * Drain the batch now, for a runtime with no `waitUntil` to hold it open.
     *
     * A Lambda freezes the instant its handler resolves, so an event captured
     * as the last thing a handler does never reaches the wire — which is
     * exactly the shape of the retrieval-ready capture (#426). Await this at
     * the handler boundary. Resolves rather than rejects on failure, same
     * never-fail-real-work contract as `captureEvent`, and is a no-op when
     * analytics is disabled or no client was ever constructed.
     */
    flush(): Promise<void>;
}

/**
 * Whether this runtime reports to PostHog.
 *
 * Explicit rather than inferred from a platform signal: apps/web used to gate
 * on `process.env.VERCEL`, which Lambda never sets, so the worker could not
 * have captured anything even with a key in hand (#425). Every runtime now
 * opts in the same way — a Vercel env var on the production and preview tiers,
 * a Terraform literal on the worker Lambda (`infra/terraform/lambda.tf`).
 * Local dev, CI, and the e2e production builds leave it unset, which is what
 * keeps them out of the funnel.
 */
export function isServerAnalyticsEnabled(): boolean {
    return process.env.ANALYTICS_ENABLED === 'true';
}

export function createServerAnalytics(
    options: ServerAnalyticsOptions
): ServerAnalytics {
    // Lazy so that importing a module which captures doesn't open a client,
    // and so tests that never capture never construct one.
    let client: PostHog | null | undefined;

    function getClient(): PostHog | null {
        if (client === undefined) {
            const enabled = options.enabled ?? isServerAnalyticsEnabled();
            client =
                enabled && options.key
                    ? new PostHog(options.key, {
                          host: options.host,
                          waitUntil: options.waitUntil,
                      })
                    : null;
        }
        return client;
    }

    return {
        captureEvent(userId, event, properties) {
            const posthog = getClient();
            if (!posthog) return;

            try {
                posthog.capture({
                    distinctId: userId,
                    event,
                    // Spread first so a caller can't accidentally shadow the
                    // environment property.
                    properties: {
                        ...properties,
                        [ANALYTICS_ENVIRONMENT_PROPERTY]: options.environment,
                    },
                });
            } catch (error) {
                // console rather than a logger: the two runtimes have
                // different ones (pino behind the app's validated env module,
                // nothing at all in the worker), and both collect stdout the
                // same way.
                console.warn(`PostHog capture failed for "${event}":`, error);
            }
        },

        async flush() {
            // `client`, not `getClient()`: nothing to drain if capture never
            // ran, and constructing a client here just to flush it would open
            // a connection on every handler exit.
            if (!client) return;

            try {
                await client.flush();
            } catch (error) {
                console.warn('PostHog flush failed:', error);
            }
        },
    };
}

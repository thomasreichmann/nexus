/**
 * The worker's binding of `@nexus/analytics` — counterpart to the app's
 * `lib/posthog/server.ts`.
 *
 * The Lambda is where the events with no session attached happen: a Glacier
 * restore completes 12-48 hours after anyone asked for it. Until #425 the
 * worker had no PostHog dependency, no key, and no way past a gate that read
 * `process.env.VERCEL`; the shared switch is now `ANALYTICS_ENABLED`, set here
 * by Terraform (`infra/terraform/lambda.tf`).
 *
 * No `waitUntil`: Lambda freezes the execution environment when the handler
 * resolves, and there is no host-provided way to extend that the way Next's
 * `after` does. `flushWorkerAnalytics` is the substitute — see its docblock for
 * why the interval flush this originally relied on isn't enough.
 */
import { DEFAULT_POSTHOG_HOST } from '@nexus/analytics/hosts';
import { createServerAnalytics } from '@nexus/analytics/server';

import { optionalEnv } from './aws';

import type { PostHogEventName } from '@nexus/analytics/events';
import type { ServerAnalytics } from '@nexus/analytics/server';

let analytics: ServerAnalytics | undefined;

function getAnalytics(): ServerAnalytics {
    analytics ??= createServerAnalytics({
        key: optionalEnv('POSTHOG_KEY'),
        host: DEFAULT_POSTHOG_HOST,
        // Terraform maps the environment name onto the same vocabulary the app
        // reports (`production` / `development`), because PostHog's "filter
        // out internal and test users" toggle is configured against the value.
        // The fallback is the filtered side on purpose: a var that went
        // missing must not start attributing worker events to production.
        environment: optionalEnv('ANALYTICS_ENVIRONMENT') ?? 'development',
    });
    return analytics;
}

/**
 * Fire-and-forget, same contract as the app's `captureServerEvent`: analytics
 * must never fail the work that triggered it.
 */
export function captureWorkerEvent(
    userId: string,
    event: PostHogEventName,
    properties?: Record<string, unknown>
): void {
    getAnalytics().captureEvent(userId, event, properties);
}

/**
 * Drain the capture batch before the Lambda freezes.
 *
 * #425 reasoned that posthog-node's interval flush lands within the invocation
 * because "the poll runs for seconds after a capture, not microseconds". That
 * holds for the poll and not for the zip handler, whose retrieval-ready capture
 * is the last thing it does (#426) — the handler resolves, the execution
 * environment freezes, and the batch is dropped unsent. Rather than reason per
 * call site about how much runway is left, every handler flushes on the way
 * out.
 *
 * Cheap when there is nothing to send: no client is constructed unless
 * something captured, and it never throws.
 */
export function flushWorkerAnalytics(): Promise<void> {
    // Not `getAnalytics()`: a handler that captured nothing shouldn't
    // construct a client on its way out.
    return analytics?.flush() ?? Promise.resolve();
}

import {
    type NewWebhookEvent,
    type WebhookEvent,
    type WebhookRepo,
} from '@nexus/db/repo/webhooks';
import { alerts } from '@/lib/alerts';
import { isUniqueViolation, toErrorMessage } from '@/lib/errors';

export type WebhookEventLookup =
    | { outcome: 'duplicate'; reason: 'processed' | 'concurrent-insert' }
    | { outcome: 'new'; event: WebhookEvent }
    | { outcome: 'retry'; event: WebhookEvent };

/**
 * Finds or creates the `webhook_events` row for an inbound delivery, and says
 * whether this delivery should be dispatched at all.
 *
 * Only `processed` counts as done. A row is inserted at `received` and moves
 * to a terminal status only after dispatch, so a crash in between leaves a
 * `received` row behind — short-circuiting on mere existence would strand it
 * permanently, because provider redelivery is the only thing that recovers a
 * delivery and it would be turned away (#331).
 */
export async function resolveWebhookEvent(
    repo: WebhookRepo,
    input: NewWebhookEvent
): Promise<WebhookEventLookup> {
    const existing = await repo.find(input.source, input.externalId);

    if (existing?.status === 'processed') {
        return { outcome: 'duplicate', reason: 'processed' };
    }

    if (existing) {
        return { outcome: 'retry', event: existing };
    }

    try {
        return { outcome: 'new', event: await repo.insert(input) };
    } catch (err) {
        // Only swallow Postgres unique-violation — that's a concurrent
        // redelivery racing us to the same row. Anything else (schema
        // mismatch, connection drop) is a real failure and must surface.
        if (isUniqueViolation(err)) {
            return { outcome: 'duplicate', reason: 'concurrent-insert' };
        }
        throw err;
    }
}

interface WebhookFailureAlert {
    title: string;
    message: string;
    /** Identifying facts; the error message is appended automatically. */
    context: Record<string, string>;
}

/**
 * Marks a delivery failed and alerts on it.
 *
 * Business errors only — callers rethrow the transient class before reaching
 * here, so that a retry is the provider's job rather than a stored row's.
 */
export async function recordWebhookFailure(
    repo: WebhookRepo,
    eventId: string,
    error: unknown,
    alert: WebhookFailureAlert
): Promise<void> {
    const errorMessage = toErrorMessage(error);

    await repo.update(eventId, { status: 'failed', error: errorMessage });

    await alerts.send({
        severity: 'error',
        title: alert.title,
        message: alert.message,
        context: { ...alert.context, error: errorMessage },
    });
}

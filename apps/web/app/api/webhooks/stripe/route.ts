import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { createWebhookRepo } from '@nexus/db/repo/webhooks';
import { alerts } from '@/lib/alerts';
import { isLocalDevelopment } from '@/lib/env/runtime';
import { isTransientInfraError } from '@/lib/errors';
import {
    recordWebhookFailure,
    resolveWebhookEvent,
} from '@/lib/webhooks/events';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { stripe } from '@/lib/stripe';
import { subscriptionService } from '@/server/services/subscriptions';

const log = logger.child({ handler: 'stripe-webhook' });

export async function POST(request: NextRequest): Promise<NextResponse> {
    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    let event: Stripe.Event;
    // Signature verification is bypassed only on a local dev machine, where
    // there is no Stripe signing secret to sign against. Every deployed
    // environment (preview and production) always verifies — see
    // `isLocalDevelopment`.
    if (!isLocalDevelopment()) {
        const signature = request.headers.get('stripe-signature');
        if (!signature) {
            return NextResponse.json(
                { error: 'Missing stripe-signature header' },
                { status: 400 }
            );
        }
        try {
            event = stripe.webhooks.constructEvent(rawBody, signature);
        } catch (err) {
            log.warn({ err }, 'Stripe signature verification failed');
            return NextResponse.json(
                { error: 'Invalid signature' },
                { status: 400 }
            );
        }
    } else {
        try {
            event = JSON.parse(rawBody) as Stripe.Event;
        } catch {
            return NextResponse.json(
                { error: 'Invalid JSON' },
                { status: 400 }
            );
        }
    }

    const webhookRepo = createWebhookRepo(db);

    const lookup = await resolveWebhookEvent(webhookRepo, {
        source: 'stripe',
        externalId: event.id,
        eventType: event.type,
        payload: event as unknown as Record<string, unknown>,
    });

    if (lookup.outcome === 'duplicate') {
        log.debug(
            { eventId: event.id, duplicate: true, reason: lookup.reason },
            'Duplicate webhook event skipped'
        );
        return NextResponse.json({ received: true, duplicate: true });
    }

    if (lookup.outcome === 'retry') {
        log.info(
            { eventId: event.id, prevStatus: lookup.event.status },
            'Retrying webhook event'
        );
    }

    const webhookEvent = lookup.event;

    const start = Date.now();
    log.info({ eventId: event.id, eventType: event.type }, 'Webhook received');

    // Every alert below identifies the same delivery; spread this in so a new
    // one can't ship with a thinner context than its siblings.
    const alertContext = {
        source: 'stripe',
        eventType: event.type,
        externalId: event.id,
    };

    try {
        const dispatch = await subscriptionService.dispatchWebhookEvent(
            db,
            event
        );

        switch (dispatch.outcome) {
            case 'applied':
                await webhookRepo.update(webhookEvent.id, {
                    status: 'processed',
                });
                break;

            case 'ignored':
                // By design, so the row stays a clean success and no alert
                // fires — see `WebhookDispatchOutcome` for why.
                log.info(
                    {
                        eventId: event.id,
                        eventType: event.type,
                        reason: dispatch.reason,
                    },
                    'Stripe event was a no-op by design'
                );
                await webhookRepo.update(webhookEvent.id, {
                    status: 'processed',
                });
                break;

            case 'noop':
                // Both halves matter: the alert catches it now, the `noop`
                // status keeps it findable by the nightly sweep long after the
                // alert has scrolled past (#332). The reason carries the
                // detail, because a no-op can still be a partial write.
                log.warn(
                    {
                        eventId: event.id,
                        eventType: event.type,
                        reason: dispatch.reason,
                    },
                    'Stripe webhook did not fully apply'
                );
                await webhookRepo.update(webhookEvent.id, {
                    status: 'noop',
                    error: dispatch.reason,
                });
                await alerts.send({
                    severity: 'warning',
                    title: 'Stripe webhook did not fully apply',
                    message: `${dispatch.reason}. The event row is marked noop.`,
                    context: { ...alertContext, reason: dispatch.reason },
                });
                break;

            case 'unhandled':
                log.warn(
                    { eventId: event.id, eventType: event.type },
                    'Unhandled Stripe event type'
                );
                await webhookRepo.update(webhookEvent.id, {
                    status: 'unhandled',
                });
                await alerts.send({
                    severity: 'warning',
                    title: 'Unhandled Stripe event type',
                    message:
                        'A Stripe webhook delivered an event type no handler matches; the event row is marked unhandled.',
                    context: alertContext,
                });
                break;

            default:
                // A new outcome variant must map to a status here. Without
                // this the row would silently stay `received` — the exact
                // false green #332 exists to kill — so fail the build instead.
                throw new Error(
                    `Unmapped webhook dispatch outcome: ${JSON.stringify(dispatch satisfies never)}`
                );
        }

        log.info(
            {
                eventId: event.id,
                eventType: event.type,
                outcome: dispatch.outcome,
                durationMs: Date.now() - start,
            },
            'Webhook processed'
        );

        return NextResponse.json({ received: true });
    } catch (error) {
        log.error(
            { err: error, eventId: event.id, eventType: event.type },
            'Webhook processing failed'
        );

        // Rethrow so the 5xx makes Stripe retry — see `isTransientInfraError`
        // for why nothing is written first (#331).
        if (isTransientInfraError(error)) throw error;

        await recordWebhookFailure(webhookRepo, webhookEvent.id, error, {
            title: 'Stripe webhook processing failed',
            message:
                'Handler threw while processing a Stripe webhook; the event row is marked failed.',
            context: alertContext,
        });

        return NextResponse.json({ received: true });
    }
}

import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { createWebhookRepo, type WebhookEvent } from '@nexus/db/repo/webhooks';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { stripe } from '@/lib/stripe';
import { subscriptionService } from '@/server/services/subscriptions';

const log = logger.child({ handler: 'stripe-webhook' });

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
    );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    let event: Stripe.Event;
    if (process.env.NODE_ENV !== 'development') {
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

    // Stripe may redeliver events during outages, or retry after a prior
    // failure. Only `processed` short-circuits — `failed` and `received` rows
    // fall through so the dispatch can re-run and recover.
    const existing = await webhookRepo.find('stripe', event.id);
    if (existing?.status === 'processed') {
        log.debug({ eventId: event.id }, 'Webhook already processed, skipping');
        return NextResponse.json({ received: true, duplicate: true });
    }

    let webhookEvent: WebhookEvent;
    if (existing) {
        webhookEvent = existing;
        log.info(
            { eventId: event.id, prevStatus: existing.status },
            'Retrying webhook event'
        );
    } else {
        try {
            webhookEvent = await webhookRepo.insert({
                source: 'stripe',
                externalId: event.id,
                eventType: event.type,
                payload: event as unknown as Record<string, unknown>,
            });
        } catch (err) {
            // Only swallow Postgres unique-violation (23505) — that's a
            // concurrent redelivery race. Anything else (schema mismatch,
            // connection drop, etc.) is a real failure and must surface.
            if (isUniqueViolation(err)) {
                log.debug(
                    { eventId: event.id },
                    'Concurrent duplicate skipped'
                );
                return NextResponse.json({
                    received: true,
                    duplicate: true,
                });
            }
            throw err;
        }
    }

    const start = Date.now();
    log.info({ eventId: event.id, eventType: event.type }, 'Webhook received');

    try {
        await subscriptionService.dispatchWebhookEvent(db, event);

        await webhookRepo.update(webhookEvent.id, { status: 'processed' });

        log.info(
            {
                eventId: event.id,
                eventType: event.type,
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

        await webhookRepo.update(webhookEvent.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
        });

        return NextResponse.json({ received: true });
    }
}

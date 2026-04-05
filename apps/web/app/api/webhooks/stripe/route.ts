import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { createWebhookRepo } from '@nexus/db/repo/webhooks';
import { createSubscriptionRepo } from '@nexus/db/repo/subscriptions';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { stripe } from '@/lib/stripe';
import { PLAN_LIMITS, type PlanTier } from '@/server/services/constants';
import { subscriptionStatusEnum } from '@nexus/db/schema';

const log = logger.child({ handler: 'stripe-webhook' });

const VALID_STATUSES = new Set<string>(subscriptionStatusEnum.enumValues);

/** Stripe uses expandable fields (string | object | null) — normalize to the ID string. */
function resolveStripeId(
    field: string | { id: string } | null | undefined
): string | undefined {
    if (!field) return undefined;
    return typeof field === 'string' ? field : field.id;
}

type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];

/** Map Stripe status to our DB enum, falling back to existing value for unknown statuses. */
function mapStripeStatus(
    stripeStatus: string,
    fallback: SubscriptionStatus
): SubscriptionStatus {
    if (VALID_STATUSES.has(stripeStatus)) {
        return stripeStatus as SubscriptionStatus;
    }
    log.warn(
        { stripeStatus },
        'Unknown Stripe subscription status, using fallback'
    );
    return fallback;
}

function resolveTierFromSubscription(
    sub: Stripe.Subscription
): PlanTier | null {
    const item = sub.items.data[0];
    if (!item) return null;
    const product = item.price.product as Stripe.Product | string;
    const metadata =
        typeof product === 'string' ? null : (product.metadata ?? null);
    return (metadata?.tier as PlanTier) ?? null;
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

    // Stripe may redeliver events during outages
    const existing = await webhookRepo.find('stripe', event.id);
    if (existing) {
        log.debug(
            { eventId: event.id, duplicate: true },
            'Duplicate webhook event skipped'
        );
        return NextResponse.json({ received: true, duplicate: true });
    }

    let webhookEvent;
    try {
        webhookEvent = await webhookRepo.insert({
            source: 'stripe',
            externalId: event.id,
            eventType: event.type,
            payload: event as unknown as Record<string, unknown>,
        });
    } catch {
        // Unique constraint violation from concurrent redelivery
        log.debug({ eventId: event.id }, 'Concurrent duplicate skipped');
        return NextResponse.json({ received: true, duplicate: true });
    }

    const start = Date.now();
    log.info({ eventId: event.id, eventType: event.type }, 'Webhook received');

    try {
        await dispatch(event);

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

async function dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(
                event.data.object as Stripe.Checkout.Session
            );
            break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            await handleSubscriptionUpsert(
                event.data.object as Stripe.Subscription
            );
            break;
        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(
                event.data.object as Stripe.Subscription
            );
            break;
        case 'invoice.payment_failed':
            await handlePaymentFailed(event.data.object as Stripe.Invoice);
            break;
        default:
            log.debug({ eventType: event.type }, 'Unhandled event type');
    }
}

async function handleCheckoutCompleted(
    session: Stripe.Checkout.Session
): Promise<void> {
    if (session.mode !== 'subscription') return;

    const customerId = resolveStripeId(session.customer);
    const subscriptionId = resolveStripeId(session.subscription);

    if (!customerId || !subscriptionId) {
        log.warn(
            { sessionId: session.id },
            'Checkout session missing customer or subscription'
        );
        return;
    }

    const repo = createSubscriptionRepo(db);
    const sub = await repo.findByStripeCustomerId(customerId);
    if (!sub) {
        log.warn(
            { customerId, sessionId: session.id },
            'No subscription record for customer'
        );
        return;
    }

    // subscription.created will fill in plan details; this just links the IDs
    await repo.upsertFromWebhook({
        ...sub,
        stripeSubscriptionId: subscriptionId,
    });

    log.info(
        { customerId, subscriptionId },
        'Linked Stripe subscription from checkout'
    );
}

async function handleSubscriptionUpsert(
    sub: Stripe.Subscription
): Promise<void> {
    const customerId = resolveStripeId(sub.customer);
    if (!customerId) return;

    const repo = createSubscriptionRepo(db);
    const existing = await repo.findByStripeCustomerId(customerId);
    if (!existing) {
        log.warn(
            { customerId, stripeSubscriptionId: sub.id },
            'No local record for subscription upsert'
        );
        return;
    }

    const tier = resolveTierFromSubscription(sub) ?? existing.planTier;
    const storageLimit = PLAN_LIMITS[tier as PlanTier] ?? existing.storageLimit;

    // In API version 2026-02-25.clover, period fields moved from Subscription to its items
    const firstItem = sub.items.data[0];
    const periodStart = firstItem
        ? new Date(firstItem.current_period_start * 1000)
        : existing.currentPeriodStart;
    const periodEnd = firstItem
        ? new Date(firstItem.current_period_end * 1000)
        : existing.currentPeriodEnd;

    await repo.upsertFromWebhook({
        ...existing,
        stripeSubscriptionId: sub.id,
        planTier: tier,
        status: mapStripeStatus(sub.status, existing.status),
        storageLimit,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    });

    log.info(
        { customerId, tier, status: sub.status },
        'Subscription synced from webhook'
    );
}

async function handleSubscriptionDeleted(
    sub: Stripe.Subscription
): Promise<void> {
    const customerId = resolveStripeId(sub.customer);
    if (!customerId) return;

    const repo = createSubscriptionRepo(db);
    const existing = await repo.findByStripeCustomerId(customerId);
    if (!existing) {
        log.warn({ customerId }, 'No local record for subscription deletion');
        return;
    }

    await repo.upsertFromWebhook({
        ...existing,
        status: 'canceled',
        cancelAtPeriodEnd: false,
    });

    log.info({ customerId }, 'Subscription marked as canceled');
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = resolveStripeId(invoice.customer);

    if (!customerId) {
        log.warn({ invoiceId: invoice.id }, 'Invoice missing customer');
        return;
    }

    const repo = createSubscriptionRepo(db);
    const existing = await repo.findByStripeCustomerId(customerId);
    if (!existing) {
        log.warn({ customerId }, 'No local record for payment failure');
        return;
    }

    await repo.upsertFromWebhook({
        ...existing,
        status: 'past_due',
    });

    log.info(
        { customerId, invoiceId: invoice.id },
        'Subscription marked past_due'
    );
}

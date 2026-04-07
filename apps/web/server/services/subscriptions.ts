import type Stripe from 'stripe';
import type { DB } from '@nexus/db';
import {
    createSubscriptionRepo,
    type Subscription,
} from '@nexus/db/repo/subscriptions';
import { subscriptionStatusEnum } from '@nexus/db/schema';
import { env } from '@/lib/env';
import { stripe, stripeClient } from '@/lib/stripe';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { logger } from '@/server/lib/logger';
import {
    PLAN_LIMITS,
    TRIAL_DURATION_DAYS,
    type PlanTier,
    type CheckoutTier,
    type BillingInterval,
} from './constants';

const log = logger.child({ service: 'subscriptions' });

const VALID_STATUSES = new Set<string>(subscriptionStatusEnum.enumValues);

type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];

// Terminal or severe statuses that should not be overwritten by past_due
const TERMINAL_STATUSES = new Set<SubscriptionStatus>(['canceled', 'unpaid']);

// ─── Helpers ────────────────────────────────────────────────────────────

/** Stripe uses expandable fields (string | object | null) — normalize to the ID string. */
function resolveStripeId(
    field: string | { id: string } | null | undefined
): string | undefined {
    if (!field) return undefined;
    return typeof field === 'string' ? field : field.id;
}

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

/**
 * Returns the subscription item that represents the plan (vs. add-ons).
 *
 * Stripe doesn't guarantee item ordering, and a single subscription may carry
 * a base plan plus metered add-ons. We identify the plan by looking for an
 * expanded product carrying `metadata.tier`. When products aren't expanded
 * (or none have tier metadata), fall back to the first item — preserving the
 * old behavior for the common single-item case.
 */
function findPlanItem(
    sub: Stripe.Subscription
): Stripe.SubscriptionItem | undefined {
    const planItems = sub.items.data.filter((item) => {
        const product = item.price.product;
        return (
            typeof product === 'object' &&
            product !== null &&
            !('deleted' in product && product.deleted) &&
            !!product.metadata?.tier
        );
    });

    if (planItems.length > 1) {
        log.warn(
            { stripeSubId: sub.id, count: planItems.length },
            'Multiple plan items found in subscription, using first'
        );
    }

    return planItems[0] ?? sub.items.data[0];
}

async function resolveTierFromSubscription(
    sub: Stripe.Subscription
): Promise<PlanTier | null> {
    const item = findPlanItem(sub);
    if (!item) return null;

    const rawProduct = item.price.product;
    let product: Stripe.Product;

    if (typeof rawProduct === 'string') {
        try {
            product = await stripeClient.products.retrieve(rawProduct);
        } catch (err) {
            log.warn(
                { productId: rawProduct, err },
                'Failed to retrieve product from Stripe'
            );
            return null;
        }
    } else {
        product = rawProduct as Stripe.Product;
    }

    return (product.metadata?.tier as PlanTier) ?? null;
}

// ─── tRPC-facing service methods ────────────────────────────────────────

async function getCurrentSubscription(
    db: DB,
    userId: string
): Promise<Subscription | undefined> {
    const repo = createSubscriptionRepo(db);
    return repo.findByUserId(userId);
}

async function createCheckoutSession(
    db: DB,
    userId: string,
    tier: CheckoutTier,
    interval: BillingInterval
): Promise<{ url: string }> {
    const repo = createSubscriptionRepo(db);
    const sub = await repo.findByUserId(userId);

    if (!sub) {
        throw new NotFoundError('Subscription');
    }

    const priceId = await stripe.prices.resolvePriceId(tier, interval);

    const session = await stripe.checkout.createCheckoutSession({
        customerId: sub.stripeCustomerId,
        priceId,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/settings?checkout=success`,
        cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/settings?checkout=canceled`,
    });

    if (!session.url) {
        throw new InvalidStateError('Stripe did not return a checkout URL');
    }

    log.info(
        { userId, tier, interval, sessionId: session.id },
        'Checkout session created'
    );

    return { url: session.url };
}

async function createPortalSession(
    db: DB,
    userId: string
): Promise<{ url: string }> {
    const repo = createSubscriptionRepo(db);
    const sub = await repo.findByUserId(userId);

    if (!sub) {
        throw new NotFoundError('Subscription');
    }

    const session = await stripe.checkout.createBillingPortalSession(
        sub.stripeCustomerId,
        `${env.NEXT_PUBLIC_APP_URL}/settings`
    );

    return { url: session.url };
}

/**
 * Provisions a local-only trial: creates a Stripe Customer but no Stripe
 * Subscription. The trial is tracked via `trialEnd` in the local DB.
 *
 * There is currently no automatic expiry transition — when `trialEnd` passes,
 * the row stays `status: 'trialing'`. Enforcement is soft: the upload quota
 * check in `files.ts` (`assertWithinQuota`) rejects uploads for expired trials.
 *
 * Future options for proper lifecycle handling:
 *   1. Cron job to transition expired trials to `canceled`
 *   2. Real Stripe Subscription with `trial_period_days` so Stripe manages expiry
 *   3. Middleware in `protectedProcedure` that checks trial status on every request
 */
async function provisionTrialSubscription(
    db: DB,
    userId: string,
    email: string,
    name?: string
): Promise<void> {
    const customer = await stripeClient.customers.create({
        email,
        name: name ?? undefined,
        metadata: { userId },
    });

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);

    const repo = createSubscriptionRepo(db);
    await repo.insert({
        id: crypto.randomUUID(),
        userId,
        stripeCustomerId: customer.id,
        planTier: 'starter',
        status: 'trialing',
        storageLimit: PLAN_LIMITS.starter,
        trialEnd,
    });

    log.info(
        { userId, stripeCustomerId: customer.id },
        'Trial subscription provisioned'
    );
}

// ─── Webhook event handlers ─────────────────────────────────────────────

async function handleCheckoutCompleted(
    db: DB,
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
    db: DB,
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

    const tier = (await resolveTierFromSubscription(sub)) ?? existing.planTier;
    const storageLimit = PLAN_LIMITS[tier] ?? existing.storageLimit;

    // In API version 2026-02-25.clover, period fields moved from Subscription to its items.
    // Read from the plan item (not the first add-on) so add-ons with different cycles don't override.
    const planItem = findPlanItem(sub);
    const periodStart = planItem
        ? new Date(planItem.current_period_start * 1000)
        : existing.currentPeriodStart;
    const periodEnd = planItem
        ? new Date(planItem.current_period_end * 1000)
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
    db: DB,
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

async function handlePaymentFailed(
    db: DB,
    invoice: Stripe.Invoice
): Promise<void> {
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

    // Don't regress from a more severe status if events arrive out of order
    if (TERMINAL_STATUSES.has(existing.status)) {
        log.debug(
            { customerId, currentStatus: existing.status },
            'Skipping past_due — subscription already in terminal status'
        );
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

async function dispatchWebhookEvent(
    db: DB,
    event: Stripe.Event
): Promise<void> {
    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(
                db,
                event.data.object as Stripe.Checkout.Session
            );
            break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            await handleSubscriptionUpsert(
                db,
                event.data.object as Stripe.Subscription
            );
            break;
        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(
                db,
                event.data.object as Stripe.Subscription
            );
            break;
        case 'invoice.payment_failed':
            await handlePaymentFailed(db, event.data.object as Stripe.Invoice);
            break;
        default:
            log.debug({ eventType: event.type }, 'Unhandled event type');
    }
}

export const subscriptionService = {
    getCurrentSubscription,
    createCheckoutSession,
    createPortalSession,
    provisionTrialSubscription,
    dispatchWebhookEvent,
} as const;

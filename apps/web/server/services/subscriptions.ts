import type { DB } from '@nexus/db';
import {
    createSubscriptionRepo,
    type Subscription,
} from '@nexus/db/repo/subscriptions';
import { env } from '@/lib/env';
import { stripe, stripeClient } from '@/lib/stripe';
import { logger } from '@/server/lib/logger';
import {
    PLAN_LIMITS,
    TRIAL_DURATION_DAYS,
    type CheckoutTier,
    type BillingInterval,
} from './constants';

const log = logger.child({ service: 'subscriptions' });

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
        throw new Error('No subscription record found for user');
    }

    const priceId = await stripe.prices.resolvePriceId(tier, interval);

    const session = await stripe.checkout.createCheckoutSession({
        customerId: sub.stripeCustomerId,
        priceId,
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/settings?checkout=success`,
        cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/settings?checkout=canceled`,
    });

    if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
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
        throw new Error('No subscription record found for user');
    }

    const session = await stripe.checkout.createBillingPortalSession(
        sub.stripeCustomerId,
        `${env.NEXT_PUBLIC_APP_URL}/settings`
    );

    return { url: session.url };
}

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

export const subscriptionService = {
    getCurrentSubscription,
    createCheckoutSession,
    createPortalSession,
    provisionTrialSubscription,
} as const;

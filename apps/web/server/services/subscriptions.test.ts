import { describe, expect, it, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import {
    createMockDb,
    createSubscriptionFixture,
    TEST_STRIPE_CUSTOMER_ID,
} from '@nexus/db/testing';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    const { createMockStripe } = await import('@/lib/stripe/testing');
    return { logger: createMockLogger(), ...createMockStripe() };
});

vi.mock('@/lib/env', () => ({
    env: {
        NEXT_PUBLIC_APP_URL: 'https://test.example',
        STRIPE_SECRET_KEY: 'sk_test',
    },
}));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

vi.mock('@/lib/stripe', () => ({
    stripe: hoisted.stripe,
    stripeClient: hoisted.stripeClient,
}));

import { subscriptionService } from './subscriptions';
import { PLAN_LIMITS } from './constants';

const productsRetrieve = hoisted.stripeClient.products.retrieve;

/** Wraps an arbitrary object in a Stripe.Event envelope, centralizing the cast. */
function makeStripeEvent<T>(type: string, object: T): Stripe.Event {
    return {
        id: 'evt_test',
        type,
        data: { object },
    } as unknown as Stripe.Event;
}

interface SubscriptionEventOpts {
    type?:
        | 'customer.subscription.created'
        | 'customer.subscription.updated'
        | 'customer.subscription.deleted';
    customerId?: string;
    stripeSubId?: string;
    status?: string;
    cancelAtPeriodEnd?: boolean;
    /** When set, the price.product is the ID string (unexpanded). Otherwise an object with `productMetadata`. */
    unexpandedProductId?: string;
    productMetadata?: Record<string, string>;
    periodStart?: number;
    periodEnd?: number;
    /** When true, omit `items.data` entirely (used for the deleted handler which doesn't need them). */
    noItems?: boolean;
    /**
     * Items prepended before the main plan item — use to simulate add-ons or
     * non-plan items appearing at index 0, exercising findPlanItem's selector.
     */
    prependItems?: Array<{
        productMetadata?: Record<string, string>;
        periodStart?: number;
        periodEnd?: number;
    }>;
}

function makeSubscriptionItem(opts: {
    productMetadata?: Record<string, string>;
    periodStart?: number;
    periodEnd?: number;
    productId?: string;
}) {
    return {
        current_period_start: opts.periodStart ?? 1_700_000_000,
        current_period_end: opts.periodEnd ?? 1_702_000_000,
        price: {
            product: {
                id: opts.productId ?? 'prod_test',
                metadata: opts.productMetadata ?? {},
            },
        },
    };
}

function makeSubscriptionEvent(opts: SubscriptionEventOpts = {}): Stripe.Event {
    const mainProduct = opts.unexpandedProductId ?? {
        id: 'prod_test',
        metadata: opts.productMetadata ?? {},
    };

    const mainItem = {
        current_period_start: opts.periodStart ?? 1_700_000_000,
        current_period_end: opts.periodEnd ?? 1_702_000_000,
        price: { product: mainProduct },
    };

    const prepended = (opts.prependItems ?? []).map((extra, idx) =>
        makeSubscriptionItem({ ...extra, productId: `prod_extra_${idx}` })
    );

    const items = opts.noItems
        ? { data: [] }
        : { data: [...prepended, mainItem] };

    const subscription = {
        id: opts.stripeSubId ?? 'sub_stripe_test',
        customer: opts.customerId ?? TEST_STRIPE_CUSTOMER_ID,
        status: opts.status ?? 'active',
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        trial_end: null,
        items,
    };

    return makeStripeEvent(
        opts.type ?? 'customer.subscription.updated',
        subscription
    );
}

function makePaymentFailedEvent(
    customerId: string | null = TEST_STRIPE_CUSTOMER_ID
): Stripe.Event {
    return makeStripeEvent('invoice.payment_failed', {
        id: 'in_test',
        customer: customerId,
    });
}

describe('subscriptionService.dispatchWebhookEvent', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    describe('invoice.payment_failed', () => {
        it('transitions active subscription to past_due', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ status: 'active' })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent()
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'past_due' })
            );
        });

        it('does not regress from canceled status', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ status: 'canceled' })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent()
            );

            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.values).not.toHaveBeenCalled();
        });

        it('does not regress from unpaid status', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ status: 'unpaid' })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent()
            );

            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.values).not.toHaveBeenCalled();
        });

        it('no-ops when no local subscription exists', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(undefined);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent()
            );

            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.values).not.toHaveBeenCalled();
        });

        it('no-ops when invoice has no customer', async () => {
            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent(null)
            );

            expect(mocks.subscriptions.findFirst).not.toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
        });
    });

    describe('customer.subscription.updated', () => {
        it('updates tier and storage limit from product metadata', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({
                    planTier: 'starter',
                    storageLimit: PLAN_LIMITS.starter,
                })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({ productMetadata: { tier: 'pro' } })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                    status: 'active',
                })
            );
        });

        it('preserves existing tier when Stripe product has no tier metadata', async () => {
            // Regression guard: a Stripe config mistake (missing metadata)
            // must not silently downgrade an existing pro subscription.
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({ productMetadata: {} })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                })
            );
        });

        it('maps Stripe status to DB enum', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ status: 'active' })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({
                    status: 'past_due',
                    productMetadata: { tier: 'starter' },
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'past_due' })
            );
        });

        it('falls back to existing status on unknown Stripe status', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ status: 'active' })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({
                    status: 'some_future_stripe_status',
                    productMetadata: { tier: 'starter' },
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'active' })
            );
        });

        it('reads period dates from subscription items (post-2026-02-25)', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture()
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({
                    productMetadata: { tier: 'starter' },
                    periodStart: 1_700_000_000,
                    periodEnd: 1_702_000_000,
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    currentPeriodStart: new Date(1_700_000_000 * 1000),
                    currentPeriodEnd: new Date(1_702_000_000 * 1000),
                })
            );
        });

        it('selects plan item from multi-item subscription regardless of order', async () => {
            // A metered add-on at index 0, with the real plan item second.
            // The old `items.data[0]` selector would have used the add-on's
            // empty metadata + cycle. findPlanItem must pick the tiered item.
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ planTier: 'starter' })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({
                    prependItems: [
                        {
                            // add-on with no tier metadata, different cycle
                            productMetadata: {},
                            periodStart: 1_500_000_000,
                            periodEnd: 1_500_500_000,
                        },
                    ],
                    productMetadata: { tier: 'pro' },
                    periodStart: 1_700_000_000,
                    periodEnd: 1_702_000_000,
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                    currentPeriodStart: new Date(1_700_000_000 * 1000),
                    currentPeriodEnd: new Date(1_702_000_000 * 1000),
                })
            );
        });

        it('no-ops when no local subscription exists', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(undefined);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({ productMetadata: { tier: 'pro' } })
            );

            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.values).not.toHaveBeenCalled();
            expect(productsRetrieve).not.toHaveBeenCalled();
        });

        it('retrieves product from Stripe when not expanded', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ planTier: 'starter' })
            );
            productsRetrieve.mockResolvedValue({
                id: 'prod_test',
                metadata: { tier: 'max' },
            });

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({ unexpandedProductId: 'prod_test' })
            );

            expect(productsRetrieve).toHaveBeenCalledWith('prod_test');
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'max',
                    storageLimit: PLAN_LIMITS.max,
                })
            );
        });

        it('preserves existing tier when product retrieval fails', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({ planTier: 'pro' })
            );
            productsRetrieve.mockRejectedValue(new Error('stripe api error'));

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({ unexpandedProductId: 'prod_test' })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                })
            );
        });
    });

    describe('customer.subscription.deleted', () => {
        it('marks subscription as canceled', async () => {
            mocks.subscriptions.findFirst.mockResolvedValue(
                createSubscriptionFixture({
                    status: 'active',
                    cancelAtPeriodEnd: true,
                })
            );

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionEvent({
                    type: 'customer.subscription.deleted',
                    noItems: true,
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'canceled',
                    cancelAtPeriodEnd: false,
                })
            );
        });
    });

    it('ignores unhandled event types without error', async () => {
        await subscriptionService.dispatchWebhookEvent(
            db,
            makeStripeEvent('some.other.event', {})
        );

        expect(mocks.subscriptions.findFirst).not.toHaveBeenCalled();
        expect(mocks.insert).not.toHaveBeenCalled();
    });
});

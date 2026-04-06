import { describe, expect, it, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import {
    createMockDb,
    createSubscriptionFixture,
    TEST_STRIPE_CUSTOMER_ID,
} from '@nexus/db/testing';

// vi.mock factories are hoisted above regular code, so any variables they
// reference must be declared via vi.hoisted(). This block owns the shared
// mocks that tests later reach into.
const hoisted = vi.hoisted(() => {
    const loggerStub = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
    };
    loggerStub.child.mockReturnValue(loggerStub);

    return {
        loggerStub,
        productsRetrieve: vi.fn(),
    };
});

// Env: stub so the service module can be imported without .env.local loaded
vi.mock('@/lib/env', () => ({
    env: {
        NEXT_PUBLIC_APP_URL: 'https://test.example',
        STRIPE_SECRET_KEY: 'sk_test',
    },
}));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.loggerStub }));

// Stripe SDK: mocked so the service can import without hitting the network.
// Individual tests override `productsRetrieve` when they need to assert behavior.
vi.mock('@/lib/stripe', () => ({
    stripe: {
        webhooks: {},
        checkout: {
            createCheckoutSession: vi.fn(),
            createBillingPortalSession: vi.fn(),
        },
        prices: { resolvePriceId: vi.fn() },
    },
    stripeClient: {
        customers: { create: vi.fn() },
        products: { retrieve: hoisted.productsRetrieve },
    },
}));

const { productsRetrieve } = hoisted;

import { subscriptionService } from './subscriptions';
import { PLAN_LIMITS } from './constants';

describe('subscriptionService.dispatchWebhookEvent', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    // ─── invoice.payment_failed ────────────────────────────────────────

    describe('invoice.payment_failed', () => {
        function makePaymentFailedEvent(customerId: string): Stripe.Event {
            return {
                id: 'evt_test',
                type: 'invoice.payment_failed',
                data: {
                    object: {
                        id: 'in_test',
                        customer: customerId,
                    } as unknown as Stripe.Invoice,
                },
            } as unknown as Stripe.Event;
        }

        it('transitions active subscription to past_due', async () => {
            const existing = createSubscriptionFixture({ status: 'active' });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([
                { ...existing, status: 'past_due' },
            ]);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent(TEST_STRIPE_CUSTOMER_ID)
            );

            // The upsert's .values(...) receives the full row to write
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'past_due' })
            );
        });

        it('does not regress from canceled status', async () => {
            const existing = createSubscriptionFixture({ status: 'canceled' });
            mocks.findFirst.mockResolvedValue(existing);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent(TEST_STRIPE_CUSTOMER_ID)
            );

            // Terminal status guard: no write at all
            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.values).not.toHaveBeenCalled();
        });

        it('does not regress from unpaid status', async () => {
            const existing = createSubscriptionFixture({ status: 'unpaid' });
            mocks.findFirst.mockResolvedValue(existing);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makePaymentFailedEvent(TEST_STRIPE_CUSTOMER_ID)
            );

            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.values).not.toHaveBeenCalled();
        });

        it('no-ops when no local subscription exists', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            await expect(
                subscriptionService.dispatchWebhookEvent(
                    db,
                    makePaymentFailedEvent(TEST_STRIPE_CUSTOMER_ID)
                )
            ).resolves.toBeUndefined();

            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('no-ops when invoice has no customer', async () => {
            const event = {
                id: 'evt_test',
                type: 'invoice.payment_failed',
                data: {
                    object: {
                        id: 'in_test',
                        customer: null,
                    } as unknown as Stripe.Invoice,
                },
            } as unknown as Stripe.Event;

            await subscriptionService.dispatchWebhookEvent(db, event);

            expect(mocks.findFirst).not.toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
        });
    });

    // ─── customer.subscription.updated ─────────────────────────────────

    describe('customer.subscription.updated', () => {
        /**
         * Builds a Stripe.Subscription with a pre-expanded product object so
         * the handler never hits `stripeClient.products.retrieve`. Each test
         * can override product metadata to exercise tier-resolution branches.
         */
        function makeSubscriptionUpsertEvent(opts: {
            stripeSubId?: string;
            customerId?: string;
            status?: string;
            productMetadata?: Record<string, string>;
            periodStart?: number;
            periodEnd?: number;
        }): Stripe.Event {
            const item = {
                current_period_start: opts.periodStart ?? 1_700_000_000,
                current_period_end: opts.periodEnd ?? 1_702_000_000,
                price: {
                    product: {
                        id: 'prod_test',
                        metadata: opts.productMetadata ?? {},
                    },
                },
            };

            const subscription = {
                id: opts.stripeSubId ?? 'sub_stripe_test',
                customer: opts.customerId ?? TEST_STRIPE_CUSTOMER_ID,
                status: opts.status ?? 'active',
                cancel_at_period_end: false,
                trial_end: null,
                items: { data: [item] },
            };

            return {
                id: 'evt_test',
                type: 'customer.subscription.updated',
                data: {
                    object: subscription as unknown as Stripe.Subscription,
                },
            } as unknown as Stripe.Event;
        }

        it('updates tier and storage limit from product metadata', async () => {
            const existing = createSubscriptionFixture({
                planTier: 'starter',
                storageLimit: PLAN_LIMITS.starter,
            });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([
                { ...existing, planTier: 'pro' },
            ]);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionUpsertEvent({
                    productMetadata: { tier: 'pro' },
                })
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
            const existing = createSubscriptionFixture({
                planTier: 'pro',
                storageLimit: PLAN_LIMITS.pro,
            });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([existing]);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionUpsertEvent({ productMetadata: {} })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                })
            );
        });

        it('maps Stripe status to DB enum', async () => {
            const existing = createSubscriptionFixture({ status: 'active' });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([existing]);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionUpsertEvent({
                    status: 'past_due',
                    productMetadata: { tier: 'starter' },
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'past_due' })
            );
        });

        it('falls back to existing status on unknown Stripe status', async () => {
            const existing = createSubscriptionFixture({ status: 'active' });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([existing]);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionUpsertEvent({
                    status: 'some_future_stripe_status',
                    productMetadata: { tier: 'starter' },
                })
            );

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'active' })
            );
        });

        it('reads period dates from subscription items (post-2026-02-25)', async () => {
            const existing = createSubscriptionFixture();
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([existing]);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionUpsertEvent({
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

        it('no-ops when no local subscription exists', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            await subscriptionService.dispatchWebhookEvent(
                db,
                makeSubscriptionUpsertEvent({
                    productMetadata: { tier: 'pro' },
                })
            );

            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('retrieves product from Stripe when not expanded', async () => {
            const existing = createSubscriptionFixture({ planTier: 'starter' });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([existing]);

            productsRetrieve.mockResolvedValue({
                id: 'prod_test',
                metadata: { tier: 'max' },
            });

            // Unexpanded product: just the ID string, not the full object
            const event = {
                id: 'evt_test',
                type: 'customer.subscription.updated',
                data: {
                    object: {
                        id: 'sub_stripe_test',
                        customer: TEST_STRIPE_CUSTOMER_ID,
                        status: 'active',
                        cancel_at_period_end: false,
                        trial_end: null,
                        items: {
                            data: [
                                {
                                    current_period_start: 1_700_000_000,
                                    current_period_end: 1_702_000_000,
                                    price: { product: 'prod_test' },
                                },
                            ],
                        },
                    } as unknown as Stripe.Subscription,
                },
            } as unknown as Stripe.Event;

            await subscriptionService.dispatchWebhookEvent(db, event);

            expect(productsRetrieve).toHaveBeenCalledWith('prod_test');
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'max',
                    storageLimit: PLAN_LIMITS.max,
                })
            );
        });

        it('preserves existing tier when product retrieval fails', async () => {
            const existing = createSubscriptionFixture({ planTier: 'pro' });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([existing]);

            productsRetrieve.mockRejectedValue(new Error('stripe api error'));

            const event = {
                id: 'evt_test',
                type: 'customer.subscription.updated',
                data: {
                    object: {
                        id: 'sub_stripe_test',
                        customer: TEST_STRIPE_CUSTOMER_ID,
                        status: 'active',
                        cancel_at_period_end: false,
                        trial_end: null,
                        items: {
                            data: [
                                {
                                    current_period_start: 1_700_000_000,
                                    current_period_end: 1_702_000_000,
                                    price: { product: 'prod_test' },
                                },
                            ],
                        },
                    } as unknown as Stripe.Subscription,
                },
            } as unknown as Stripe.Event;

            await subscriptionService.dispatchWebhookEvent(db, event);

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    planTier: 'pro',
                    storageLimit: PLAN_LIMITS.pro,
                })
            );
        });
    });

    // ─── customer.subscription.deleted ─────────────────────────────────

    describe('customer.subscription.deleted', () => {
        it('marks subscription as canceled', async () => {
            const existing = createSubscriptionFixture({
                status: 'active',
                cancelAtPeriodEnd: true,
            });
            mocks.findFirst.mockResolvedValue(existing);
            mocks.returning.mockResolvedValue([
                { ...existing, status: 'canceled' },
            ]);

            const event = {
                id: 'evt_test',
                type: 'customer.subscription.deleted',
                data: {
                    object: {
                        id: 'sub_stripe_test',
                        customer: TEST_STRIPE_CUSTOMER_ID,
                        items: { data: [] },
                    } as unknown as Stripe.Subscription,
                },
            } as unknown as Stripe.Event;

            await subscriptionService.dispatchWebhookEvent(db, event);

            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'canceled',
                    cancelAtPeriodEnd: false,
                })
            );
        });
    });

    // ─── unhandled events ──────────────────────────────────────────────

    it('ignores unhandled event types without error', async () => {
        const event = {
            id: 'evt_test',
            type: 'some.other.event',
            data: { object: {} },
        } as unknown as Stripe.Event;

        await expect(
            subscriptionService.dispatchWebhookEvent(db, event)
        ).resolves.toBeUndefined();

        expect(mocks.findFirst).not.toHaveBeenCalled();
        expect(mocks.insert).not.toHaveBeenCalled();
    });
});

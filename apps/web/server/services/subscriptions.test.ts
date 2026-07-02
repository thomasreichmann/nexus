import { describe, expect, it, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import {
    createMockDb,
    createInviteFixture,
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
import { PLAN_LIMITS, SPONSORED_DEFAULT_STORAGE_LIMIT } from './constants';

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

describe('subscriptionService.provisionSignupSubscription', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    const user = {
        id: 'user_new',
        email: 'tester@example.com',
        name: 'Tester',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        hoisted.stripeClient.customers.create.mockResolvedValue({
            id: 'cus_new_test',
        });
    });

    /** All rows passed to `.values()` across the test, for path assertions. */
    function insertedRows(): Array<Record<string, unknown>> {
        return mocks.values.mock.calls.map((call) => call[0]);
    }

    it('provisions a trial when no invite token is present', async () => {
        await subscriptionService.provisionSignupSubscription(db, user, null);

        expect(mocks.invites.findFirst).not.toHaveBeenCalled();
        expect(insertedRows()).toEqual([
            expect.objectContaining({
                userId: user.id,
                status: 'trialing',
                storageLimit: PLAN_LIMITS.starter,
            }),
        ]);
    });

    it('provisions a sponsored subscription from a valid pending invite', async () => {
        const invite = createInviteFixture();
        mocks.invites.findFirst.mockResolvedValue(invite);
        // First `.returning()` is the claim UPDATE — it must yield the row
        mocks.returning.mockResolvedValueOnce([invite]);

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            invite.token
        );

        // Invite atomically claimed for this user...
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'redeemed',
                redeemedByUserId: user.id,
                redeemedAt: expect.any(Date),
            })
        );
        // ...and the row is sponsored, capped at the default, with no expiry
        expect(insertedRows()).toEqual([
            expect.objectContaining({
                userId: user.id,
                status: 'sponsored',
                storageLimit: SPONSORED_DEFAULT_STORAGE_LIMIT,
                trialEnd: null,
                stripeCustomerId: 'cus_new_test',
            }),
        ]);
    });

    it('uses the invite storageLimit override when present', async () => {
        const invite = createInviteFixture({ storageLimit: 20 * 1024 ** 4 });
        mocks.invites.findFirst.mockResolvedValue(invite);
        mocks.returning.mockResolvedValueOnce([invite]);

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            invite.token
        );

        expect(mocks.values).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'sponsored',
                storageLimit: 20 * 1024 ** 4,
            })
        );
    });

    it('falls back to trial when the token matches no invite', async () => {
        mocks.invites.findFirst.mockResolvedValue(undefined);

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'unknown-token'
        );

        expect(mocks.update).not.toHaveBeenCalled();
        expect(insertedRows()).toEqual([
            expect.objectContaining({ status: 'trialing' }),
        ]);
        expect(hoisted.logger.warn).toHaveBeenCalled();
    });

    it('falls back to trial and logs loudly on an email-binding mismatch', async () => {
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ email: 'invited@example.com' })
        );

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'token'
        );

        // No claim attempt, no Stripe customer burned on the sponsored path
        expect(mocks.update).not.toHaveBeenCalled();
        expect(hoisted.stripeClient.customers.create).toHaveBeenCalledTimes(1);
        expect(insertedRows()).toEqual([
            expect.objectContaining({ status: 'trialing' }),
        ]);
        // The mismatch is surfaced to monitoring with both addresses
        expect(hoisted.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                inviteEmail: 'invited@example.com',
                signupEmail: user.email,
            }),
            expect.stringContaining('email mismatch')
        );
    });

    it('matches email binding case-insensitively', async () => {
        const invite = createInviteFixture({ email: 'Tester@Example.COM' });
        mocks.invites.findFirst.mockResolvedValue(invite);
        mocks.returning.mockResolvedValueOnce([invite]);

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            invite.token
        );

        expect(mocks.values).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'sponsored' })
        );
    });

    it('does not raise the email-mismatch alert for an already-redeemed invite', async () => {
        // A re-click of a consumed email-bound link by a different email is
        // benign ("already redeemed"), not a wrong-email signup — it must take
        // the quiet warn path, or monitoring drowns in false positives.
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({
                status: 'redeemed',
                email: 'invited@example.com',
            })
        );

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'token'
        );

        expect(insertedRows()).toEqual([
            expect.objectContaining({ status: 'trialing' }),
        ]);
        expect(hoisted.logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'redeemed' }),
            expect.stringContaining('no longer pending')
        );
        expect(hoisted.logger.error).not.toHaveBeenCalled();
    });

    it('falls back to trial when the subscription insert fails after the claim', async () => {
        // The claim and insert share a transaction — a failed insert rolls
        // the claim back in real Postgres (not observable through this mock,
        // which has no rollback semantics). This pins the error path: the
        // failure escapes the transaction and still lands on a trial.
        const invite = createInviteFixture();
        mocks.invites.findFirst.mockResolvedValue(invite);
        mocks.returning.mockResolvedValueOnce([invite]);
        mocks.values.mockImplementationOnce(() => {
            throw new Error('insert failed');
        });

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            invite.token
        );

        // The claim ran before the insert blew up...
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'redeemed' })
        );
        // ...and the user still ends up on a trial, signup unblocked
        // (the first .values() call is the sponsored insert that threw)
        expect(mocks.values).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'trialing' })
        );
        expect(hoisted.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ userId: user.id }),
            'Sponsored provisioning failed; provisioning trial instead'
        );
    });

    it('falls back to trial on a repeat redemption (invite already redeemed)', async () => {
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ status: 'redeemed' })
        );

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'token'
        );

        expect(mocks.update).not.toHaveBeenCalled();
        expect(insertedRows()).toEqual([
            expect.objectContaining({ status: 'trialing' }),
        ]);
    });

    it('falls back to trial when the invite is expired', async () => {
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ expiresAt: new Date(Date.now() - 1000) })
        );

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'token'
        );

        expect(mocks.update).not.toHaveBeenCalled();
        expect(insertedRows()).toEqual([
            expect.objectContaining({ status: 'trialing' }),
        ]);
    });

    it('falls back to trial when the atomic claim loses a concurrent race', async () => {
        // Pre-check sees a pending invite, but the conditional UPDATE matches
        // nothing — a concurrent signup claimed it in between.
        mocks.invites.findFirst.mockResolvedValue(createInviteFixture());
        // default mocks.returning resolves [] → claim comes back empty

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'token'
        );

        expect(insertedRows()).toEqual([
            expect.objectContaining({ status: 'trialing' }),
        ]);
        expect(hoisted.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ userId: user.id }),
            expect.stringContaining('lost a concurrent race')
        );
    });

    it('falls back to trial when the sponsored path fails on infrastructure', async () => {
        mocks.invites.findFirst.mockResolvedValue(createInviteFixture());
        hoisted.stripeClient.customers.create
            .mockRejectedValueOnce(new Error('stripe down'))
            .mockResolvedValueOnce({ id: 'cus_retry_test' });

        await subscriptionService.provisionSignupSubscription(
            db,
            user,
            'token'
        );

        expect(insertedRows()).toEqual([
            expect.objectContaining({
                status: 'trialing',
                stripeCustomerId: 'cus_retry_test',
            }),
        ]);
        expect(hoisted.logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ userId: user.id }),
            'Sponsored provisioning failed; provisioning trial instead'
        );
    });

    it('rethrows when trial provisioning itself fails (loud signup failure)', async () => {
        hoisted.stripeClient.customers.create.mockRejectedValue(
            new Error('stripe down')
        );

        await expect(
            subscriptionService.provisionSignupSubscription(db, user, null)
        ).rejects.toThrow('stripe down');

        expect(mocks.values).not.toHaveBeenCalled();
    });
});

// Pins the Stripe redirect URLs to `/dashboard/settings`. The original PR
// shipped with `/settings` (a 404), and a string-only regression has no
// other guard — neither typecheck nor smoke catches a wrong path.
describe('subscriptionService Stripe redirect URLs', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        mocks.subscriptions.findFirst.mockResolvedValue(
            createSubscriptionFixture({ status: 'trialing' })
        );
        hoisted.stripe.prices.resolvePriceId.mockResolvedValue('price_test');
        hoisted.stripe.checkout.createCheckoutSession.mockResolvedValue({
            url: 'https://checkout.stripe.test/abc',
        });
        hoisted.stripe.checkout.createBillingPortalSession.mockResolvedValue({
            url: 'https://billing.stripe.test/xyz',
        });
    });

    it('createCheckoutSession success/cancel URLs target /dashboard/settings', async () => {
        await subscriptionService.createCheckoutSession(
            db,
            'user-test',
            'pro',
            'month'
        );

        expect(
            hoisted.stripe.checkout.createCheckoutSession
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                successUrl:
                    'https://test.example/dashboard/settings?checkout=success',
                cancelUrl:
                    'https://test.example/dashboard/settings?checkout=canceled',
            })
        );
    });

    it('createPortalSession return URL targets /dashboard/settings', async () => {
        await subscriptionService.createPortalSession(db, 'user-test');

        expect(
            hoisted.stripe.checkout.createBillingPortalSession
        ).toHaveBeenCalledWith(
            expect.any(String),
            'https://test.example/dashboard/settings'
        );
    });
});

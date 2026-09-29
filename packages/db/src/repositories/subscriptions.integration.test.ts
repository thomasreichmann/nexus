import { it, expect, describe } from '../test-db/integration';
import { insertSubscription } from '../test-db';
import { PLAN_LIMITS } from '../plans';
import { createSubscriptionRepo } from './subscriptions';

describe.concurrent('subscriptions repository', () => {
    // Backs the tRPC context's plan: another user's subscription must never
    // come back as yours.
    it('findByUserId returns the user’s own subscription, and nothing for a user without one', async ({
        db,
        user,
        createUser,
    }) => {
        const [other, withoutOne] = await Promise.all([
            createUser(),
            createUser(),
        ]);
        await insertSubscription(db, { userId: other.id });
        const own = await insertSubscription(db, { userId: user.id });
        const repo = createSubscriptionRepo(db);

        expect((await repo.findByUserId(user.id))?.id).toBe(own.id);
        expect(await repo.findByUserId(withoutOne.id)).toBeUndefined();
    });

    // How a Stripe webhook resolves which user an event is about.
    it('findByStripeCustomerId returns the subscription with that customer id only', async ({
        db,
        user,
        createUser,
    }) => {
        const other = await createUser();
        await insertSubscription(db, { userId: other.id });
        const own = await insertSubscription(db, { userId: user.id });
        const repo = createSubscriptionRepo(db);

        expect(
            (await repo.findByStripeCustomerId(own.stripeCustomerId))?.id
        ).toBe(own.id);
        expect(
            await repo.findByStripeCustomerId(`cus_test_${crypto.randomUUID()}`)
        ).toBeUndefined();
    });
});

describe.concurrent('upsertFromWebhook', () => {
    it('updates the customer’s existing subscription in place', async ({
        db,
        user,
        createUser,
    }) => {
        const bystanderUser = await createUser();
        const bystander = await insertSubscription(db, {
            userId: bystanderUser.id,
        });
        const existing = await insertSubscription(db, { userId: user.id });
        const repo = createSubscriptionRepo(db);
        const paid = {
            stripeSubscriptionId: `sub_test_${crypto.randomUUID()}`,
            planTier: 'pro' as const,
            status: 'active' as const,
            storageLimit: PLAN_LIMITS.pro,
            currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
            cancelAtPeriodEnd: true,
            trialEnd: null,
        };

        // The webhook handlers spread the row they found, as here.
        const upserted = await repo.upsertFromWebhook({ ...existing, ...paid });

        expect(upserted).toMatchObject({ id: existing.id, ...paid });
        expect(await repo.findByUserId(user.id)).toMatchObject({
            id: existing.id,
            ...paid,
        });
        expect(await repo.findByUserId(bystanderUser.id)).toEqual(bystander);
    });

    it('inserts a subscription for a customer it hasn’t seen', async ({
        db,
        user,
    }) => {
        const repo = createSubscriptionRepo(db);
        const data = {
            id: crypto.randomUUID(),
            userId: user.id,
            stripeCustomerId: `cus_test_${crypto.randomUUID()}`,
            status: 'active' as const,
            planTier: 'max' as const,
            storageLimit: PLAN_LIMITS.max,
        };

        const upserted = await repo.upsertFromWebhook(data);

        expect(upserted).toMatchObject(data);
        expect(await repo.findByUserId(user.id)).toMatchObject(data);
    });

    // `userId` is deliberately left out of the update: an event carrying the
    // wrong user must not hand one user's subscription to another.
    it('never moves an existing subscription to another user', async ({
        db,
        user,
        createUser,
    }) => {
        const other = await createUser();
        const existing = await insertSubscription(db, { userId: user.id });
        const repo = createSubscriptionRepo(db);

        const upserted = await repo.upsertFromWebhook({
            ...existing,
            userId: other.id,
            status: 'active',
        });

        expect(upserted).toMatchObject({
            id: existing.id,
            userId: user.id,
            status: 'active',
        });
        expect(await repo.findByUserId(other.id)).toBeUndefined();
    });
});

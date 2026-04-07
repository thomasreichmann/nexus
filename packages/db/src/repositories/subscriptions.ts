import { eq } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type Subscription = typeof schema.subscriptions.$inferSelect;
export type NewSubscription = typeof schema.subscriptions.$inferInsert;

export type SubscriptionPlan = Pick<Subscription, 'storageLimit' | 'planTier'>;

function findByUserId(
    db: DB,
    userId: string
): Promise<Subscription | undefined> {
    return db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.userId, userId),
    });
}

function findByStripeCustomerId(
    db: DB,
    customerId: string
): Promise<Subscription | undefined> {
    return db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.stripeCustomerId, customerId),
    });
}

async function insert(db: DB, data: NewSubscription): Promise<Subscription> {
    const [sub] = await db
        .insert(schema.subscriptions)
        .values(data)
        .returning();
    return sub;
}

async function upsertFromWebhook(
    db: DB,
    data: NewSubscription
): Promise<Subscription> {
    const [sub] = await db
        .insert(schema.subscriptions)
        .values(data)
        .onConflictDoUpdate({
            target: schema.subscriptions.stripeCustomerId,
            set: {
                stripeSubscriptionId: data.stripeSubscriptionId,
                planTier: data.planTier,
                status: data.status,
                storageLimit: data.storageLimit,
                currentPeriodStart: data.currentPeriodStart,
                currentPeriodEnd: data.currentPeriodEnd,
                cancelAtPeriodEnd: data.cancelAtPeriodEnd,
                trialEnd: data.trialEnd,
            },
        })
        .returning();
    return sub;
}

export const createSubscriptionRepo = createRepository({
    findByUserId,
    findByStripeCustomerId,
    insert,
    upsertFromWebhook,
});

export type SubscriptionRepo = ReturnType<typeof createSubscriptionRepo>;

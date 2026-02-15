import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    bigint,
    boolean,
    index,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { timestamps } from './helpers';

export const planTierEnum = pgEnum('plan_tier', [
    'starter',
    'pro',
    'max',
    'enterprise',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
    'trialing', // In free trial period
    'active', // Paying and in good standing
    'past_due', // Payment failed, grace period
    'canceled', // Subscription ended
    'unpaid', // Payment failed, access restricted
    'incomplete', // Initial payment pending
]);

export const subscriptions = pgTable(
    'subscriptions',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .unique()
            .references(() => user.id, { onDelete: 'cascade' }),
        stripeCustomerId: text('stripe_customer_id').notNull().unique(),
        stripeSubscriptionId: text('stripe_subscription_id').unique(),
        planTier: planTierEnum('plan_tier').notNull().default('starter'),
        status: subscriptionStatusEnum('status').notNull().default('trialing'),
        storageLimit: bigint('storage_limit', { mode: 'number' }).notNull(),
        currentPeriodStart: timestamp('current_period_start'),
        currentPeriodEnd: timestamp('current_period_end'),
        cancelAtPeriodEnd: boolean('cancel_at_period_end')
            .notNull()
            .default(false),
        trialEnd: timestamp('trial_end'),
        ...timestamps(),
    },
    (table) => [index('subscriptions_status_idx').on(table.status)]
);

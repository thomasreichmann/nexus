import { eq } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type SubscriptionPlan = Pick<
    typeof schema.subscriptions.$inferSelect,
    'storageLimit' | 'planTier'
>;

function findByUserId(
    db: DB,
    userId: string
): Promise<SubscriptionPlan | undefined> {
    return db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.userId, userId),
        columns: { storageLimit: true, planTier: true },
    });
}

export const createSubscriptionRepo = createRepository({
    findByUserId,
});

export type SubscriptionRepo = ReturnType<typeof createSubscriptionRepo>;

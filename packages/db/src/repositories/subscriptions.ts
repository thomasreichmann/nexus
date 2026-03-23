import { eq } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type Subscription = typeof schema.subscriptions.$inferSelect;

function findByUserId(
    db: DB,
    userId: string
): Promise<Subscription | undefined> {
    return db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.userId, userId),
    });
}

export const createSubscriptionRepo = createRepository({
    findByUserId,
});

export type SubscriptionRepo = ReturnType<typeof createSubscriptionRepo>;

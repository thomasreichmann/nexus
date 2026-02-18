import { eq, and } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type WebhookEvent = typeof schema.webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof schema.webhookEvents.$inferInsert;

function find(
    db: DB,
    source: WebhookEvent['source'],
    externalId: string
): Promise<WebhookEvent | undefined> {
    return db.query.webhookEvents.findFirst({
        where: and(
            eq(schema.webhookEvents.source, source),
            eq(schema.webhookEvents.externalId, externalId)
        ),
    });
}

async function insert(db: DB, data: NewWebhookEvent): Promise<WebhookEvent> {
    const [event] = await db
        .insert(schema.webhookEvents)
        .values(data)
        .returning();
    return event;
}

async function update(
    db: DB,
    id: string,
    data: Pick<Partial<WebhookEvent>, 'status' | 'error'>
): Promise<WebhookEvent | undefined> {
    const [event] = await db
        .update(schema.webhookEvents)
        .set(data)
        .where(eq(schema.webhookEvents.id, id))
        .returning();
    return event;
}

export const createWebhookRepo = createRepository({
    find,
    insert,
    update,
});

export type WebhookRepo = ReturnType<typeof createWebhookRepo>;

import { eq, and } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';

export type WebhookEvent = typeof schema.webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof schema.webhookEvents.$inferInsert;

export function findWebhookEvent(
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

export async function insertWebhookEvent(
    db: DB,
    data: NewWebhookEvent
): Promise<WebhookEvent> {
    const [event] = await db
        .insert(schema.webhookEvents)
        .values(data)
        .returning();
    return event;
}

export async function updateWebhookEvent(
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

export function createWebhookRepo(db: DB) {
    return {
        find: (source: WebhookEvent['source'], externalId: string) =>
            findWebhookEvent(db, source, externalId),
        insert: (data: NewWebhookEvent) => insertWebhookEvent(db, data),
        update: (
            id: string,
            data: Pick<Partial<WebhookEvent>, 'status' | 'error'>
        ) => updateWebhookEvent(db, id, data),
    };
}
export type WebhookRepo = ReturnType<typeof createWebhookRepo>;

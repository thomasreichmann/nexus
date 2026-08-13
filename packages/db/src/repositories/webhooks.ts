import { eq, and, gte, inArray } from 'drizzle-orm';
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

/** The subset the health sweep prints; `id` and `payload` would only be noise. */
export type StrandedWebhookEvent = Pick<
    WebhookEvent,
    'status' | 'eventType' | 'error' | 'createdAt'
>;

/**
 * Events that reached a status needing a human — the handler threw, matched
 * nothing, or matched but applied nothing. Scoped by source so each webhook
 * strand can define its own set (`noop` is Stripe-only, #332).
 */
function findStranded(
    db: DB,
    source: WebhookEvent['source'],
    statuses: WebhookEvent['status'][],
    createdAfter: Date
): Promise<StrandedWebhookEvent[]> {
    return db
        .select({
            status: schema.webhookEvents.status,
            eventType: schema.webhookEvents.eventType,
            error: schema.webhookEvents.error,
            createdAt: schema.webhookEvents.createdAt,
        })
        .from(schema.webhookEvents)
        .where(
            and(
                eq(schema.webhookEvents.source, source),
                inArray(schema.webhookEvents.status, statuses),
                gte(schema.webhookEvents.createdAt, createdAfter)
            )
        );
}

export const createWebhookRepo = createRepository({
    find,
    insert,
    update,
    findStranded,
});

export type WebhookRepo = ReturnType<typeof createWebhookRepo>;

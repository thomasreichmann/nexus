import { eq, and, gte, inArray, lt } from 'drizzle-orm';
import * as schema from '../schema';
import { createRepository } from './create';
import type { DB } from '../connection';

export type WebhookEvent = typeof schema.webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof schema.webhookEvents.$inferInsert;

/** The subset the health sweep prints; `id` and `payload` would only be noise. */
export type StrandedWebhookEvent = Pick<
    WebhookEvent,
    'status' | 'eventType' | 'error' | 'createdAt'
>;

/**
 * Same idea for the stuck-at-`received` sweep, but `error` is always null on
 * those rows and the source varies, since that query spans both strands.
 */
export type StuckWebhookEvent = Pick<
    WebhookEvent,
    'id' | 'source' | 'eventType' | 'createdAt'
>;

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

/**
 * Deliveries accepted but never acted on: a row is inserted at `received` and
 * only moves after dispatch, so a crash in between strands it there (#331).
 * Unscoped by source — a Stripe strand is the same silent hole as an SNS one.
 */
function findStuckAtReceived(
    db: DB,
    createdBefore: Date
): Promise<StuckWebhookEvent[]> {
    return db
        .select({
            id: schema.webhookEvents.id,
            source: schema.webhookEvents.source,
            eventType: schema.webhookEvents.eventType,
            createdAt: schema.webhookEvents.createdAt,
        })
        .from(schema.webhookEvents)
        .where(
            and(
                eq(schema.webhookEvents.status, 'received'),
                lt(schema.webhookEvents.createdAt, createdBefore)
            )
        );
}

export const createWebhookRepo = createRepository({
    find,
    insert,
    update,
    findStranded,
    findStuckAtReceived,
});

export type WebhookRepo = ReturnType<typeof createWebhookRepo>;

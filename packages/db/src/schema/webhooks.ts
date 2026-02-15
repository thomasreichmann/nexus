import {
    pgTable,
    pgEnum,
    text,
    jsonb,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { timestamps } from './helpers';

export const webhookSourceEnum = pgEnum('webhook_source', ['stripe', 'sns']);

export const webhookStatusEnum = pgEnum('webhook_status', [
    'received',
    'processed',
    'failed',
]);

export const webhookEvents = pgTable(
    'webhook_events',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        source: webhookSourceEnum('source').notNull(),
        externalId: text('external_id').notNull(),
        eventType: text('event_type').notNull(),
        payload: jsonb('payload').notNull(),
        status: webhookStatusEnum('status').notNull().default('received'),
        error: text('error'),
        ...timestamps(),
    },
    (table) => [
        uniqueIndex('webhook_events_source_external_id_idx').on(
            table.source,
            table.externalId
        ),
        index('webhook_events_status_created_at_idx').on(
            table.status,
            table.createdAt
        ),
    ]
);

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

// `noop` (#332): a handler matched but the change didn't land. Distinct from
// `processed` because it needs a human, from `failed` because nothing threw.
// The reason goes in `error`; see `WebhookDispatchOutcome` for the full set.
export const webhookStatusEnum = pgEnum('webhook_status', [
    'received',
    'processed',
    'failed',
    'unhandled',
    'noop',
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

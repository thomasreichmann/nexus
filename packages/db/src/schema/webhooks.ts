import {
    pgTable,
    pgEnum,
    text,
    jsonb,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { timestamps } from './helpers';

// `sns` is retired (#416): it named the transport, not the producer, and the
// only rail that used it — S3 lifecycle/restore events — is gone. The value
// stays in the type because Postgres cannot drop an enum value and the
// historical rows are a real record of a rail that ran. Nothing writes it.
export const webhookSourceEnum = pgEnum('webhook_source', [
    'stripe',
    'sns',
    'cloudwatch',
]);

// `noop` (#332): a handler matched but the change didn't land. Distinct from
// `processed` because it needs a human, from `failed` because nothing threw.
// The reason goes in `error`; the full status table lives in
// `docs/guides/webhooks.md`.
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

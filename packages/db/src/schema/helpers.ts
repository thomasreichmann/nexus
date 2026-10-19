import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Standard timestamp columns for all tables.
 * Use by spreading into table definition: `...timestamps()`.
 *
 * - `createdAt` - Set once on insert via database default
 * - `updatedAt` - Auto-updates on every Drizzle update via $onUpdate()
 *
 * `timestamptz`, like every timestamp in the schema (#488): a plain
 * `timestamp` stores a wall-clock reading with no zone, so `now()` lands in
 * whatever zone the inserting session is set to, and anything that reads it
 * without drizzle's column mapper reads it in its own.
 */
export const timestamps = () => ({
    createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
});

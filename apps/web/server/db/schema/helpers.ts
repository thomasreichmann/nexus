import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Standard timestamp columns for all tables.
 * Use by spreading into table definition: `...timestamps()`.
 *
 * - `createdAt` - Set once on insert via database default
 * - `updatedAt` - Auto-updates on every Drizzle update via $onUpdate()
 */
export const timestamps = () => ({
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
});

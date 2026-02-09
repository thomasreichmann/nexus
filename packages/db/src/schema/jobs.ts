import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    integer,
    jsonb,
    index,
} from 'drizzle-orm/pg-core';
import { timestamps } from './helpers';

export const jobStatusEnum = pgEnum('job_status', [
    'pending',
    'processing',
    'completed',
    'failed',
]);

export const backgroundJobs = pgTable(
    'background_jobs',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        type: text('type').notNull(),
        payload: jsonb('payload').notNull(),
        status: jobStatusEnum('status').notNull().default('pending'),
        attempts: integer('attempts').notNull().default(0),
        error: text('error'),
        startedAt: timestamp('started_at'),
        completedAt: timestamp('completed_at'),
        ...timestamps(),
    },
    (table) => [
        index('background_jobs_status_created_at_idx').on(
            table.status,
            table.createdAt
        ),
    ]
);

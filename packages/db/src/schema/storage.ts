import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    bigint,
    integer,
    index,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { timestamps } from './helpers';

/**
 * Glacier restore tier values - determines retrieval speed and cost
 *
 * For Deep Archive (MVP default):
 * - expedited: Not available for Deep Archive
 * - standard: 12-48 hours
 * - bulk: 48 hours (cheapest)
 *
 * For Glacier Flexible Retrieval:
 * - expedited: 1-5 minutes (most expensive)
 * - standard: 3-5 hours
 * - bulk: 5-12 hours
 */
export const RESTORE_TIERS = ['standard', 'bulk', 'expedited'] as const;
export type RestoreTier = (typeof RESTORE_TIERS)[number];

// Nexus domain tables

export const storageTierEnum = pgEnum('storage_tier', [
    'standard',
    'glacier',
    'deep_archive',
]);

export const fileStatusEnum = pgEnum('file_status', [
    'uploading',
    'available',
    'restoring',
    'deleted',
]);

export const retrievalStatusEnum = pgEnum('retrieval_status', [
    'pending', // Request created, not yet sent to AWS
    'in_progress', // AWS restore initiated, waiting for completion
    'ready', // File restored and available for download
    'expired', // Temporary restore window has passed
    'failed', // Restore failed (e.g., file deleted, AWS error)
    'cancelled', // User cancelled before completion
]);

export const retrievalTierEnum = pgEnum('retrieval_tier', RESTORE_TIERS);

// Groups files uploaded together in a single session. The natural unit of
// work for photographers is "a shoot" — one wedding/event = one batch. Batch
// FK is nullable on files/retrievals so legacy rows (pre-batch) keep working.
export const uploadBatches = pgTable(
    'upload_batches',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        ...timestamps(),
    },
    (table) => [index('upload_batches_user_id_idx').on(table.userId)]
);

export const files = pgTable(
    'files',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        // Nullable: legacy files predate batches; `set null` preserves the
        // file row when a batch is removed (rare; prevents data loss).
        batchId: text('batch_id').references(() => uploadBatches.id, {
            onDelete: 'set null',
        }),
        name: text('name').notNull(),
        size: bigint('size', { mode: 'number' }).notNull(),
        mimeType: text('mime_type'),
        s3Key: text('s3_key').notNull().unique(),
        storageTier: storageTierEnum('storage_tier')
            .notNull()
            .default('glacier'),
        status: fileStatusEnum('status').notNull().default('uploading'),
        ...timestamps(),
        lastAccessedAt: timestamp('last_accessed_at'),
        deletedAt: timestamp('deleted_at'),
    },
    (table) => [
        index('files_user_id_idx').on(table.userId),
        index('files_status_idx').on(table.status),
        index('files_storage_tier_idx').on(table.storageTier),
        index('files_batch_id_idx').on(table.batchId),
        index('files_user_id_created_at_idx').on(
            table.userId,
            table.createdAt.desc()
        ),
    ]
);

export const storageUsage = pgTable(
    'storage_usage',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .unique()
            .references(() => user.id, { onDelete: 'cascade' }),
        usedBytes: bigint('used_bytes', { mode: 'number' })
            .notNull()
            .default(0),
        fileCount: integer('file_count').notNull().default(0),
        ...timestamps(),
    },
    (table) => [index('storage_usage_user_id_idx').on(table.userId)]
);

export const retrievals = pgTable(
    'retrievals',
    {
        id: text('id').primaryKey(),
        fileId: text('file_id')
            .notNull()
            .references(() => files.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        // Set when the retrieval was initiated as part of a batch restore.
        // `set null` so deleting a batch row doesn't wipe retrieval history.
        batchId: text('batch_id').references(() => uploadBatches.id, {
            onDelete: 'set null',
        }),
        status: retrievalStatusEnum('status').notNull().default('pending'),
        tier: retrievalTierEnum('tier').notNull().default('standard'),
        initiatedAt: timestamp('initiated_at'), // When AWS restore was started
        readyAt: timestamp('ready_at'), // When file became available
        expiresAt: timestamp('expires_at'), // When temporary restore expires
        failedAt: timestamp('failed_at'), // When failure occurred
        errorMessage: text('error_message'), // AWS error details if failed
        ...timestamps(),
    },
    (table) => [
        index('retrievals_file_id_idx').on(table.fileId),
        index('retrievals_user_id_idx').on(table.userId),
        index('retrievals_status_idx').on(table.status),
        index('retrievals_batch_id_idx').on(table.batchId),
        index('retrievals_expires_at_idx').on(table.expiresAt),
    ]
);

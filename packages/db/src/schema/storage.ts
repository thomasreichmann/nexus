import { sql } from 'drizzle-orm';
import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    bigint,
    integer,
    index,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { RESTORE_TIERS } from '../objectState';
import { user } from './auth';
import { timestamps } from './helpers';

// The retrieval-policy constants are defined in `../objectState`, not here:
// client components import them, and reaching them through this file would
// ship drizzle and every table below to the browser. Re-exported so
// `@nexus/db/schema` consumers still find them where they always were.
export {
    RESTORE_TIERS,
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    type RestoreTier,
} from '../objectState';

// Nexus domain tables

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

export const thumbnailStatusEnum = pgEnum('thumbnail_status', [
    'pending', // Set at insert; generate-thumbnail job not yet completed
    'ready', // WebP exists in the derived bucket (worker writes S3 first)
    'failed', // Bad/unreadable file — icon fallback forever
    'failed_cold', // Original hit Deep Archive before generation; self-heals on restore
    'skipped', // No thumbnail applicable: deleted before the job ran, or non-media type
]);

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
        status: fileStatusEnum('status').notNull().default('uploading'),
        // Thumbnail lifecycle for the derived-bucket WebP. No key column:
        // the derived key is a pure function of immutable row fields
        // (`${userId}/${fileId}/thumb.webp`), so the DB stays source of truth.
        thumbnailStatus: thumbnailStatusEnum('thumbnail_status')
            .notNull()
            .default('pending'),
        // Worker-populated once the thumbnail is ready. Not consumed by the
        // grid yet (its media boxes are a fixed ratio by design); kept for
        // exact-aspect sizing in a future lightbox/preview surface.
        thumbnailWidth: integer('thumbnail_width'),
        thumbnailHeight: integer('thumbnail_height'),
        // Video-only, from ffprobe; drives the duration badge.
        durationSeconds: integer('duration_seconds'),
        ...timestamps(),
        lastAccessedAt: timestamp('last_accessed_at'),
        deletedAt: timestamp('deleted_at'),
    },
    (table) => [
        index('files_user_id_idx').on(table.userId),
        index('files_status_idx').on(table.status),
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
        // At most one active retrieval per file. `expires_at > now()` isn't
        // indexable (now() is not IMMUTABLE), so a lapsed `ready` row still
        // occupies the index slot until the insert path flips it to
        // `expired` — see expireLapsedByFileIds in repositories/retrievals.
        uniqueIndex('retrievals_active_file_id_idx')
            .on(table.fileId)
            .where(sql`status IN ('pending', 'in_progress', 'ready')`),
    ]
);

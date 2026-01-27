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
import { RESTORE_TIERS } from '@/lib/storage/types';

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

export const files = pgTable(
    'files',
    {
        id: text('id').primaryKey(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
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
        status: retrievalStatusEnum('status').notNull().default('pending'),
        tier: retrievalTierEnum('tier').notNull().default('standard'),
        ...timestamps(),
        initiatedAt: timestamp('initiated_at'), // When AWS restore was started
        readyAt: timestamp('ready_at'), // When file became available
        expiresAt: timestamp('expires_at'), // When temporary restore expires
        failedAt: timestamp('failed_at'), // When failure occurred
        errorMessage: text('error_message'), // AWS error details if failed
    },
    (table) => [
        index('retrievals_file_id_idx').on(table.fileId),
        index('retrievals_user_id_idx').on(table.userId),
        index('retrievals_status_idx').on(table.status),
        index('retrievals_expires_at_idx').on(table.expiresAt),
    ]
);

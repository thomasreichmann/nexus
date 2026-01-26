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
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
        createdAt: timestamp('created_at').notNull().defaultNow(),
        updatedAt: timestamp('updated_at').notNull().defaultNow(),
    },
    (table) => [index('storage_usage_user_id_idx').on(table.userId)]
);

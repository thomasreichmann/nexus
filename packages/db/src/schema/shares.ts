import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    bigint,
    integer,
    index,
} from 'drizzle-orm/pg-core';
import { timestamps } from './helpers';

export const shareStatusEnum = pgEnum('share_status', [
    'uploading', // Link minted, bytes still on their way to S3
    'ready', // The uploader finished every file; the link is live
]);

/**
 * Public 24-hour share links. Anonymous: a share belongs to no user, so
 * nothing cascades it away and nothing here counts toward anyone's quota.
 */
export const shares = pgTable(
    'shares',
    {
        // The slug in `/s/<id>`, and the only credential: whoever holds it can
        // download.
        id: text('id').primaryKey(),
        status: shareStatusEnum('status').notNull().default('uploading'),
        // Keyed hash of the uploader's IP. It exists for the per-IP creation
        // limits and nothing else; the address itself is never stored.
        ipHash: text('ip_hash').notNull(),
        // Sum of the files' sizes, kept here so the creation limits are one
        // scan of this table.
        totalSize: bigint('total_size', { mode: 'number' }).notNull(),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        ...timestamps(),
    },
    (table) => [
        // The two reads the creation limits make: one uploader's recent
        // shares, and everyone's.
        index('shares_ip_hash_created_at_idx').on(
            table.ipHash,
            table.createdAt
        ),
        index('shares_created_at_idx').on(table.createdAt),
    ]
);

export const shareFiles = pgTable(
    'share_files',
    {
        id: text('id').primaryKey(),
        shareId: text('share_id')
            .notNull()
            .references(() => shares.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        size: bigint('size', { mode: 'number' }).notNull(),
        // `${shareId}/${fileId}` in the shares bucket. The filename stays out
        // of the key: it only ever reaches S3 as a download's disposition.
        s3Key: text('s3_key').notNull(),
        // The order the uploader picked the files in.
        position: integer('position').notNull(),
        // Download URLs issued for this file, capped at
        // MAX_DOWNLOADS_PER_SHARED_FILE so one link can't run up unbounded
        // egress.
        downloadCount: integer('download_count').notNull().default(0),
        ...timestamps(),
    },
    (table) => [index('share_files_share_id_idx').on(table.shareId)]
);

import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    boolean,
    bigint,
    index,
} from 'drizzle-orm/pg-core';

// BetterAuth tables
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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

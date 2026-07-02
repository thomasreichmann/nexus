import {
    pgTable,
    pgEnum,
    text,
    timestamp,
    bigint,
    uniqueIndex,
    index,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { timestamps } from './helpers';

export const inviteStatusEnum = pgEnum('invite_status', [
    'pending', // Issued, not yet used
    'redeemed', // Consumed by a signup (single-use)
    'revoked', // Withdrawn by an admin before redemption
]);

/**
 * Admin-issued invite links granting sponsored (comped) access. Redeeming one
 * at signup provisions a `sponsored` subscription instead of a trial.
 */
export const invites = pgTable(
    'invites',
    {
        id: text('id').primaryKey(),
        // Crypto-random, ≥128 bits of entropy — the token IS the credential
        token: text('token').notNull(),
        // Optional binding: when set, signup under a different email falls
        // back to a trial (server-side backstop; the UI lock lives in #246)
        email: text('email'),
        // Per-tester override; null → SPONSORED_DEFAULT_STORAGE_LIMIT
        storageLimit: bigint('storage_limit', { mode: 'number' }),
        status: inviteStatusEnum('status').notNull().default('pending'),
        expiresAt: timestamp('expires_at'),
        createdBy: text('created_by')
            .notNull()
            .references(() => user.id),
        redeemedByUserId: text('redeemed_by_user_id').references(
            () => user.id,
            // Keep the invite as a historical record if the account is deleted
            { onDelete: 'set null' }
        ),
        redeemedAt: timestamp('redeemed_at'),
        ...timestamps(),
    },
    (table) => [
        uniqueIndex('invites_token_idx').on(table.token),
        index('invites_status_idx').on(table.status),
    ]
);

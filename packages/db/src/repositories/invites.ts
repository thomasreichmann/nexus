import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type Invite = typeof schema.invites.$inferSelect;
export type NewInvite = typeof schema.invites.$inferInsert;

function findById(db: DB, id: string): Promise<Invite | undefined> {
    return db.query.invites.findFirst({
        where: eq(schema.invites.id, id),
    });
}

function findByToken(db: DB, token: string): Promise<Invite | undefined> {
    return db.query.invites.findFirst({
        where: eq(schema.invites.token, token),
    });
}

async function insert(db: DB, data: NewInvite): Promise<Invite> {
    const [invite] = await db.insert(schema.invites).values(data).returning();
    return invite;
}

/**
 * Atomically claim a pending, unexpired invite for `userId`. The conditional
 * UPDATE is the single-use gate: a concurrent or repeat redemption finds no
 * matching row and gets `undefined` back — losers must fall back to trial
 * provisioning, never throw.
 */
async function claim(
    db: DB,
    token: string,
    userId: string,
    now: Date = new Date()
): Promise<Invite | undefined> {
    const [invite] = await db
        .update(schema.invites)
        .set({ status: 'redeemed', redeemedByUserId: userId, redeemedAt: now })
        .where(
            and(
                eq(schema.invites.token, token),
                eq(schema.invites.status, 'pending'),
                or(
                    isNull(schema.invites.expiresAt),
                    gt(schema.invites.expiresAt, now)
                )
            )
        )
        .returning();
    return invite;
}

/** Revoke a pending invite; returns `undefined` when it isn't pending (or doesn't exist). */
async function revoke(db: DB, id: string): Promise<Invite | undefined> {
    const [invite] = await db
        .update(schema.invites)
        .set({ status: 'revoked' })
        .where(
            and(eq(schema.invites.id, id), eq(schema.invites.status, 'pending'))
        )
        .returning();
    return invite;
}

export const createInviteRepo = createRepository({
    findById,
    findByToken,
    insert,
    claim,
    revoke,
});

export type InviteRepo = ReturnType<typeof createInviteRepo>;

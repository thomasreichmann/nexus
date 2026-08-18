import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { createRepository } from './create';
import type { DB } from '../connection';

export type Invite = typeof schema.invites.$inferSelect;
export type NewInvite = typeof schema.invites.$inferInsert;

// Re-exported so the derived-expiry rule and `claim`'s SQL gate — the same
// rule negated — are reachable from one specifier. It's defined in `../invites`
// so client components can import it without drizzle (#364).
export { isInviteExpired } from '../invites';

interface FindManyOptions {
    limit: number;
    offset: number;
    status?: Invite['status'];
}

interface FindManyResult {
    invites: Invite[];
    total: number;
}

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

async function findMany(
    db: DB,
    opts: FindManyOptions = { limit: 50, offset: 0 }
): Promise<FindManyResult> {
    const whereClause = opts.status
        ? eq(schema.invites.status, opts.status)
        : undefined;

    const [invites, [countResult]] = await Promise.all([
        db.query.invites.findMany({
            where: whereClause,
            orderBy: desc(schema.invites.createdAt),
            limit: opts.limit,
            offset: opts.offset,
        }),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.invites)
            .where(whereClause),
    ]);

    return { invites, total: countResult?.count ?? 0 };
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
 *
 * The expiry clause is `isInviteExpired` negated: that predicate is inclusive
 * (`<=`), so this one is a strict `gt` — an invite is unclaimable the instant
 * it reaches `expiresAt`. `invites.test.ts` pins the two together.
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
    findMany,
    insert,
    claim,
    revoke,
});

export type InviteRepo = ReturnType<typeof createInviteRepo>;

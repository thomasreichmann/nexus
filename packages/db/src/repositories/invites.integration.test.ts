import { count, eq } from 'drizzle-orm';
import {
    it,
    expect,
    describe,
    inRolledBackTransaction,
} from '../test-db/integration';
import { insertInvite, type DB } from '../test-db';
import * as schema from '../schema';
import { createInviteRepo, type Invite } from './invites';

const NOW = new Date('2026-08-12T12:00:00Z');
const PAST = new Date('2026-08-11T12:00:00Z');

// `findMany` is newest-first over the whole table, and the dev database is
// shared. Rows dated after every real one are the first page, whatever else
// is in there.
const AFTER_ANY_REAL_ROW = new Date('2100-01-01T00:00:00Z').getTime();
const newest = (rank: number) => new Date(AFTER_ANY_REAL_ROW - rank * 1000);

async function countWithStatus(db: DB, status: Invite['status']) {
    const [row] = await db
        .select({ count: count() })
        .from(schema.invites)
        .where(eq(schema.invites.status, status));
    return row!.count;
}

describe.concurrent('claim', () => {
    it('redeems the pending invite with that token, and only that one', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createInviteRepo(db);
        const admin = await createUser();
        const invite = await insertInvite(db, { createdBy: admin.id });
        const other = await insertInvite(db, { createdBy: admin.id });

        const claimed = await repo.claim(invite.token, user.id, NOW);

        expect(claimed).toMatchObject({
            id: invite.id,
            status: 'redeemed',
            redeemedByUserId: user.id,
            redeemedAt: NOW,
        });
        expect(await repo.findById(other.id)).toEqual(other);
    });

    // The SQL gate is `isInviteExpired` negated. Its bound is inclusive, so the
    // gate's must be strict: at the instant the badge, the redemption check
    // and the trial pre-check call an invite expired, it can't be claimed.
    it('is unclaimable from the instant it expires', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createInviteRepo(db);
        const admin = await createUser();
        const atExpiry = await insertInvite(db, {
            createdBy: admin.id,
            expiresAt: NOW,
        });
        const justBefore = await insertInvite(db, {
            createdBy: admin.id,
            expiresAt: new Date(NOW.getTime() + 1),
        });

        expect(await repo.claim(atExpiry.token, user.id, NOW)).toBeUndefined();
        expect(await repo.findById(atExpiry.id)).toEqual(atExpiry);
        expect((await repo.claim(justBefore.token, user.id, NOW))?.status).toBe(
            'redeemed'
        );
    });

    it('never re-claims a redeemed or revoked invite, and leaves both rows as they were', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createInviteRepo(db);
        const [admin, firstRedeemer] = await Promise.all([
            createUser(),
            createUser(),
        ]);
        const redeemed = await insertInvite(db, {
            createdBy: admin.id,
            status: 'redeemed',
            redeemedByUserId: firstRedeemer.id,
            redeemedAt: PAST,
        });
        const revoked = await insertInvite(db, {
            createdBy: admin.id,
            status: 'revoked',
        });

        expect(await repo.claim(redeemed.token, user.id, NOW)).toBeUndefined();
        expect(await repo.claim(revoked.token, user.id, NOW)).toBeUndefined();
        expect(await repo.findById(redeemed.id)).toEqual(redeemed);
        expect(await repo.findById(revoked.id)).toEqual(revoked);
    });
});

// Invite validation and sponsored provisioning at signup both resolve the
// token here: it must never resolve to some other invite.
describe.concurrent('findByToken', () => {
    it('returns the invite with that token, and nothing for an unknown one', async ({
        db,
        user,
    }) => {
        const repo = createInviteRepo(db);
        const [a, b] = await Promise.all([
            insertInvite(db, { createdBy: user.id }),
            insertInvite(db, { createdBy: user.id }),
        ]);

        expect(await repo.findByToken(a.token)).toEqual(a);
        expect(await repo.findByToken(b.token)).toEqual(b);
        expect(
            await repo.findByToken(`test-invite-${crypto.randomUUID()}`)
        ).toBeUndefined();
    });
});

describe.concurrent('revoke', () => {
    it('revokes that pending invite only, and not a redeemed one', async ({
        db,
        user,
        createUser,
    }) => {
        const repo = createInviteRepo(db);
        const redeemer = await createUser();
        const [pending, bystander, redeemed] = await Promise.all([
            insertInvite(db, { createdBy: user.id }),
            insertInvite(db, { createdBy: user.id }),
            insertInvite(db, {
                createdBy: user.id,
                status: 'redeemed',
                redeemedByUserId: redeemer.id,
                redeemedAt: PAST,
            }),
        ]);

        expect((await repo.revoke(pending.id))?.status).toBe('revoked');
        expect(await repo.findById(bystander.id)).toEqual(bystander);
        expect(await repo.revoke(redeemed.id)).toBeUndefined();
        expect(await repo.findById(redeemed.id)).toEqual(redeemed);
    });
});

// Each test owns the newest rows in the table while it runs, and so would the
// same test in another run (`pnpm mutate`'s workers share a database), with
// the same dates. The rows are never committed, so neither sees the other's.
describe.concurrent('findMany', () => {
    it('filters the page and the total by status', ({ db, user }) =>
        inRolledBackTransaction(db, async (tx) => {
            const seed = (status: Invite['status'], rank: number) =>
                insertInvite(tx, {
                    createdBy: user.id,
                    status,
                    createdAt: newest(rank),
                });
            const revokedA = await seed('revoked', 0);
            await seed('pending', 1);
            const revokedB = await seed('revoked', 2);
            await seed('redeemed', 3);
            // One more match than the page holds.
            await seed('revoked', 4);

            const result = await createInviteRepo(tx).findMany({
                limit: 2,
                offset: 0,
                status: 'revoked',
            });

            expect(result.invites.map((i) => i.id)).toEqual([
                revokedA.id,
                revokedB.id,
            ]);
            expect(result.total).toBe(await countWithStatus(tx, 'revoked'));
        }));

    it('pages newest first', ({ db, user }) =>
        inRolledBackTransaction(db, async (tx) => {
            const byRank: Invite[] = [];
            // One more row than the offset and the page cover. Inserted
            // oldest first, so on an empty database a query that ignored the
            // order would page through them oldest first.
            for (const rank of [3, 2, 1, 0]) {
                byRank[rank] = await insertInvite(tx, {
                    createdBy: user.id,
                    createdAt: newest(rank),
                });
            }

            const page = await createInviteRepo(tx).findMany({
                limit: 2,
                offset: 1,
            });

            expect(page.invites.map((i) => i.id)).toEqual([
                byRank[1]!.id,
                byRank[2]!.id,
            ]);
        }));
});

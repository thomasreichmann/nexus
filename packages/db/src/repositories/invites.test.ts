import { describe, expect, it, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockDb, type MockDbMocks } from './mocks';
import { createInviteFixture } from './fixtures';
import { createInviteRepo, isInviteExpired, type InviteRepo } from './invites';
import type { SQL } from 'drizzle-orm';

const NOW = new Date('2026-08-12T12:00:00Z');
const PAST = new Date('2026-08-11T12:00:00Z');
const FUTURE = new Date('2026-08-13T12:00:00Z');

describe('isInviteExpired', () => {
    it('is true for a pending invite past its expiry', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: PAST }, NOW)
        ).toBe(true);
    });

    it('is false for a pending invite that has not reached its expiry', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: FUTURE }, NOW)
        ).toBe(false);
    });

    it('treats a null expiry as never expiring', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: null }, NOW)
        ).toBe(false);
    });

    it('expires exactly at the boundary', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: NOW }, NOW)
        ).toBe(true);
    });

    // Redeemed and revoked are terminal — an elapsed expiry must not relabel
    // them, or the admin list would report a used invite as expired.
    it('is false for non-pending invites regardless of expiry', () => {
        expect(
            isInviteExpired({ status: 'redeemed', expiresAt: PAST }, NOW)
        ).toBe(false);
        expect(
            isInviteExpired({ status: 'revoked', expiresAt: PAST }, NOW)
        ).toBe(false);
    });
});

describe('invites repository', () => {
    let mocks: MockDbMocks;
    let repo: InviteRepo;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createInviteRepo(mockDb.db);
    });

    describe('findMany', () => {
        it('returns invites and total count', async () => {
            const invites = [
                createInviteFixture({ id: 'invite1' }),
                createInviteFixture({ id: 'invite2' }),
            ];
            mocks.invites.findMany.mockResolvedValue(invites);
            mocks.where.mockResolvedValue([{ count: 2 }]);

            const result = await repo.findMany();

            expect(result.invites).toEqual(invites);
            expect(result.total).toBe(2);
        });

        it('uses default pagination (limit: 50, offset: 0)', async () => {
            mocks.invites.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            await repo.findMany();

            expect(mocks.invites.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 50, offset: 0 })
            );
        });

        it('respects custom pagination options', async () => {
            mocks.invites.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            await repo.findMany({ limit: 10, offset: 20 });

            expect(mocks.invites.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 10, offset: 20 })
            );
        });

        it('filters by status when provided', async () => {
            mocks.invites.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            await repo.findMany({ limit: 50, offset: 0, status: 'pending' });

            expect(mocks.invites.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.anything() })
            );
        });

        it('returns empty result when no invites exist', async () => {
            mocks.invites.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            const result = await repo.findMany();

            expect(result.invites).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    describe('claim', () => {
        it('returns the claimed invite', async () => {
            const invite = createInviteFixture({ status: 'redeemed' });
            mocks.returning.mockResolvedValue([invite]);

            await expect(repo.claim('tok', 'user_1', NOW)).resolves.toEqual(
                invite
            );
        });

        it('returns undefined when no row matches the gate', async () => {
            mocks.returning.mockResolvedValue([]);

            await expect(
                repo.claim('tok', 'user_1', NOW)
            ).resolves.toBeUndefined();
        });

        // The gate is `isInviteExpired` negated, written in SQL. Nothing here
        // evaluates SQL, so assert on the serialized condition instead: a
        // strict `>` bound to the same `now` is the only shape that agrees
        // with the predicate's inclusive `<=` at the boundary instant. A `>=`
        // would let an invite be claimed at the exact moment the badge, the
        // redemption check, and the trial pre-check all call it expired.
        it('gates on the same expiry boundary as isInviteExpired', async () => {
            mocks.returning.mockResolvedValue([]);

            await repo.claim('tok', 'user_1', NOW);

            const [condition] = mocks.where.mock.calls[0] as [SQL];
            const { sql, params } = new PgDialect().sqlToQuery(condition);

            expect(sql).toContain('"expires_at" >');
            expect(sql).not.toContain('"expires_at" >=');
            expect(params).toContain(NOW.toISOString());
            expect(
                isInviteExpired({ status: 'pending', expiresAt: NOW }, NOW)
            ).toBe(true);
        });
    });
});

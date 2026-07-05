import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb, type MockDbMocks } from './mocks';
import { createInviteFixture } from './fixtures';
import { createInviteRepo, type InviteRepo } from './invites';

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
});

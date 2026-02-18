import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb } from './mocks';
import { createJobFixture, createNewJobFixture, TEST_JOB_ID } from './fixtures';
import { createJobRepo } from './jobs';

describe('jobs repository', () => {
    let mocks: ReturnType<typeof createMockDb>['mocks'];
    let repo: ReturnType<typeof createJobRepo>;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createJobRepo(mockDb.db);
    });

    describe('findMany', () => {
        it('returns jobs and total count', async () => {
            const jobs = [
                createJobFixture({ id: 'job1' }),
                createJobFixture({ id: 'job2' }),
            ];
            mocks.findMany.mockResolvedValue(jobs);
            mocks.where.mockResolvedValue([{ count: 2 }]);

            const result = await repo.findMany();

            expect(result.jobs).toEqual(jobs);
            expect(result.total).toBe(2);
        });

        it('uses default pagination (limit: 50, offset: 0)', async () => {
            mocks.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            await repo.findMany();

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 50,
                    offset: 0,
                })
            );
        });

        it('respects custom pagination options', async () => {
            mocks.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            await repo.findMany({ limit: 10, offset: 20 });

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 10,
                    offset: 20,
                })
            );
        });

        it('returns empty result when no jobs exist', async () => {
            mocks.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            const result = await repo.findMany();

            expect(result.jobs).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('filters by status when provided', async () => {
            mocks.findMany.mockResolvedValue([]);
            mocks.where.mockResolvedValue([{ count: 0 }]);

            await repo.findMany({ limit: 50, offset: 0, status: 'failed' });

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.anything(),
                })
            );
        });
    });

    describe('countByStatus', () => {
        it('returns counts per status', async () => {
            mocks.groupBy.mockResolvedValue([
                { status: 'pending', count: 5 },
                { status: 'processing', count: 2 },
                { status: 'completed', count: 10 },
                { status: 'failed', count: 1 },
            ]);

            const result = await repo.countByStatus();

            expect(result).toEqual({
                pending: 5,
                processing: 2,
                completed: 10,
                failed: 1,
            });
        });

        it('returns zero for statuses with no jobs', async () => {
            mocks.groupBy.mockResolvedValue([]);

            const result = await repo.countByStatus();

            expect(result).toEqual({
                pending: 0,
                processing: 0,
                completed: 0,
                failed: 0,
            });
        });
    });

    describe('insert', () => {
        it('returns inserted job', async () => {
            const newJob = createNewJobFixture();
            const insertedJob = createJobFixture();
            mocks.returning.mockResolvedValue([insertedJob]);

            const result = await repo.insert(newJob);

            expect(result).toEqual(insertedJob);
            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(newJob);
        });
    });

    describe('update', () => {
        it('returns updated job', async () => {
            const updatedJob = createJobFixture({
                status: 'processing',
                startedAt: new Date(),
            });
            mocks.returning.mockResolvedValue([updatedJob]);

            const result = await repo.update(TEST_JOB_ID, {
                status: 'processing',
                startedAt: new Date(),
            });

            expect(result).toEqual(updatedJob);
            expect(mocks.update).toHaveBeenCalledOnce();
        });

        it('returns undefined when job not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.update('nonexistent', {
                status: 'failed',
                error: 'Something went wrong',
            });

            expect(result).toBeUndefined();
        });
    });
});

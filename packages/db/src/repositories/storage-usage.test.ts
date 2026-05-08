import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb, type MockDbMocks } from './mocks';
import { createStorageUsageFixture, TEST_USER_ID } from './fixtures';
import { createStorageUsageRepo, type StorageUsageRepo } from './storage-usage';

describe('storage-usage repository', () => {
    let mocks: MockDbMocks;
    let repo: StorageUsageRepo;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createStorageUsageRepo(mockDb.db);
    });

    describe('getUsage', () => {
        it('returns usedBytes and fileCount when row exists', async () => {
            const row = createStorageUsageFixture({
                usedBytes: 1024,
                fileCount: 3,
            });
            mocks.storageUsage.findFirst.mockResolvedValue(row);

            const result = await repo.getUsage(TEST_USER_ID);

            expect(result).toEqual({ usedBytes: 1024, fileCount: 3 });
        });

        it('returns zero snapshot when no row exists for the user', async () => {
            mocks.storageUsage.findFirst.mockResolvedValue(undefined);

            const result = await repo.getUsage(TEST_USER_ID);

            expect(result).toEqual({ usedBytes: 0, fileCount: 0 });
        });
    });

    describe('incrementUsage', () => {
        it('upserts and returns the new snapshot', async () => {
            const updated = createStorageUsageFixture({
                usedBytes: 2048,
                fileCount: 2,
            });
            mocks.returning.mockResolvedValue([updated]);

            const result = await repo.incrementUsage(TEST_USER_ID, 1024);

            expect(result).toEqual({ usedBytes: 2048, fileCount: 2 });
            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: TEST_USER_ID,
                    usedBytes: 1024,
                    fileCount: 1,
                })
            );
            expect(mocks.onConflictDoUpdate).toHaveBeenCalledOnce();
        });
    });

    describe('decrementUsage', () => {
        it('returns the updated snapshot', async () => {
            const updated = createStorageUsageFixture({
                usedBytes: 500,
                fileCount: 1,
            });
            mocks.returning.mockResolvedValue([updated]);

            const result = await repo.decrementUsage(TEST_USER_ID, 100);

            expect(result).toEqual({ usedBytes: 500, fileCount: 1 });
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledOnce();
        });

        it('accepts a fileCount for batched deletes', async () => {
            const updated = createStorageUsageFixture({
                usedBytes: 0,
                fileCount: 0,
            });
            mocks.returning.mockResolvedValue([updated]);

            const result = await repo.decrementUsage(TEST_USER_ID, 5000, 5);

            expect(result).toEqual({ usedBytes: 0, fileCount: 0 });
            expect(mocks.update).toHaveBeenCalledOnce();
        });

        it('returns zero snapshot when no row exists', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.decrementUsage(TEST_USER_ID, 100);

            expect(result).toEqual({ usedBytes: 0, fileCount: 0 });
        });
    });
});

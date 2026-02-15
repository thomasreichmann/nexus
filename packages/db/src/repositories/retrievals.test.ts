import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb } from './mocks';
import {
    createRetrievalFixture,
    TEST_USER_ID,
    TEST_FILE_ID,
    TEST_RETRIEVAL_ID,
} from './fixtures';
import {
    findByFileId,
    findByFileIds,
    findByUser,
    insert,
    insertMany,
    updateStatus,
} from './retrievals';

describe('retrievals repository', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    describe('findByFileId', () => {
        it('returns active retrieval when found', async () => {
            const retrieval = createRetrievalFixture();
            mocks.findFirst.mockResolvedValue(retrieval);

            const result = await findByFileId(db, TEST_FILE_ID);

            expect(result).toEqual(retrieval);
            expect(mocks.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when no active retrieval exists', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            const result = await findByFileId(db, 'nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('findByFileIds', () => {
        it('returns active retrievals for multiple files', async () => {
            const retrievals = [
                createRetrievalFixture({ id: 'r1', fileId: 'file1' }),
                createRetrievalFixture({ id: 'r2', fileId: 'file2' }),
            ];
            mocks.findMany.mockResolvedValue(retrievals);

            const result = await findByFileIds(db, ['file1', 'file2']);

            expect(result).toEqual(retrievals);
            expect(mocks.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty ids', async () => {
            const result = await findByFileIds(db, []);

            expect(result).toEqual([]);
            expect(mocks.findMany).not.toHaveBeenCalled();
        });
    });

    describe('findByUser', () => {
        it('returns all retrievals for user', async () => {
            const retrievals = [
                createRetrievalFixture({ id: 'r1' }),
                createRetrievalFixture({ id: 'r2', status: 'ready' }),
            ];
            mocks.findMany.mockResolvedValue(retrievals);

            const result = await findByUser(db, TEST_USER_ID);

            expect(result).toEqual(retrievals);
            expect(mocks.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when user has no retrievals', async () => {
            mocks.findMany.mockResolvedValue([]);

            const result = await findByUser(db, TEST_USER_ID);

            expect(result).toEqual([]);
        });
    });

    describe('insert', () => {
        it('returns inserted retrieval', async () => {
            const retrieval = createRetrievalFixture();
            mocks.returning.mockResolvedValue([retrieval]);

            const result = await insert(db, {
                id: TEST_RETRIEVAL_ID,
                fileId: TEST_FILE_ID,
                userId: TEST_USER_ID,
                tier: 'standard',
                status: 'pending',
            });

            expect(result).toEqual(retrieval);
            expect(mocks.insert).toHaveBeenCalledOnce();
        });
    });

    describe('insertMany', () => {
        it('returns inserted retrievals', async () => {
            const retrievals = [
                createRetrievalFixture({ id: 'r1', fileId: 'file1' }),
                createRetrievalFixture({ id: 'r2', fileId: 'file2' }),
            ];
            mocks.returning.mockResolvedValue(retrievals);

            const result = await insertMany(db, [
                {
                    id: 'r1',
                    fileId: 'file1',
                    userId: TEST_USER_ID,
                    tier: 'standard',
                    status: 'pending',
                },
                {
                    id: 'r2',
                    fileId: 'file2',
                    userId: TEST_USER_ID,
                    tier: 'standard',
                    status: 'pending',
                },
            ]);

            expect(result).toEqual(retrievals);
            expect(mocks.insert).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty array', async () => {
            const result = await insertMany(db, []);

            expect(result).toEqual([]);
            expect(mocks.insert).not.toHaveBeenCalled();
        });
    });

    describe('updateStatus', () => {
        it('returns updated retrieval', async () => {
            const updated = createRetrievalFixture({
                status: 'in_progress',
                initiatedAt: new Date(),
            });
            mocks.returning.mockResolvedValue([updated]);

            const result = await updateStatus(
                db,
                TEST_RETRIEVAL_ID,
                'in_progress',
                { initiatedAt: new Date() }
            );

            expect(result).toEqual(updated);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'in_progress' })
            );
        });

        it('returns undefined when retrieval not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await updateStatus(db, 'nonexistent', 'failed');

            expect(result).toBeUndefined();
        });

        it('includes metadata fields when provided', async () => {
            const now = new Date();
            const updated = createRetrievalFixture({
                status: 'failed',
                failedAt: now,
                errorMessage: 'AWS error',
            });
            mocks.returning.mockResolvedValue([updated]);

            await updateStatus(db, TEST_RETRIEVAL_ID, 'failed', {
                failedAt: now,
                errorMessage: 'AWS error',
            });

            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'failed',
                    failedAt: now,
                    errorMessage: 'AWS error',
                })
            );
        });
    });
});

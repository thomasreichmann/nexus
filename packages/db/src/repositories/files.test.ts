import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb, type MockDbMocks } from './mocks';
import {
    createFileFixture,
    createNewFileFixture,
    createUploadBatchFixture,
    TEST_BATCH_ID,
    TEST_USER_ID,
    TEST_FILE_ID,
} from './fixtures';
import { createFileRepo, type FileRepo } from './files';

describe('files repository', () => {
    let mocks: MockDbMocks;
    let repo: FileRepo;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createFileRepo(mockDb.db);
    });

    describe('findById', () => {
        it('returns file when found', async () => {
            const file = createFileFixture();
            mocks.files.findFirst.mockResolvedValue(file);

            const result = await repo.findById(TEST_FILE_ID);

            expect(result).toEqual(file);
            expect(mocks.files.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when not found', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            const result = await repo.findById('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('findByUserAndId', () => {
        it('returns file when user owns it', async () => {
            const file = createFileFixture();
            mocks.files.findFirst.mockResolvedValue(file);

            const result = await repo.findByUserAndId(
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(file);
            expect(mocks.files.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when user does not own file', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            const result = await repo.findByUserAndId(
                'other_user',
                TEST_FILE_ID
            );

            expect(result).toBeUndefined();
        });
    });

    describe('findManyByUserAndIds', () => {
        it('returns files matching ids owned by user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findManyByUserAndIds(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toEqual(files);
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty ids', async () => {
            const result = await repo.findManyByUserAndIds(TEST_USER_ID, []);

            expect(result).toEqual([]);
            expect(mocks.files.findMany).not.toHaveBeenCalled();
        });

        it('returns only files that exist and are owned by user', async () => {
            const files = [createFileFixture({ id: 'file1' })];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findManyByUserAndIds(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toHaveLength(1);
        });
    });

    describe('findByUser', () => {
        const DEFAULT_OPTS = { limit: 50, offset: 0 } as const;

        it('returns array of files for user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findByUser(TEST_USER_ID, DEFAULT_OPTS);

            expect(result).toEqual(files);
            expect(result).toHaveLength(2);
        });

        it('respects custom pagination options', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID, { limit: 10, offset: 20 });

            expect(mocks.files.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 10,
                    offset: 20,
                })
            );
        });

        it('returns empty array when user has no files', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            const result = await repo.findByUser(TEST_USER_ID, DEFAULT_OPTS);

            expect(result).toEqual([]);
        });

        it('respects includeHidden option', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID, {
                limit: 50,
                offset: 0,
                includeHidden: true,
            });

            // When includeHidden is true, the where clause should only filter by userId
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });
    });

    describe('countByUser', () => {
        it('returns count of files for user', async () => {
            mocks.where.mockResolvedValue([{ count: 42 }]);

            const result = await repo.countByUser(TEST_USER_ID);

            expect(result).toBe(42);
        });

        it('returns 0 when user has no files', async () => {
            mocks.where.mockResolvedValue([{ count: 0 }]);

            const result = await repo.countByUser(TEST_USER_ID);

            expect(result).toBe(0);
        });

        it('respects includeHidden option', async () => {
            mocks.where.mockResolvedValue([{ count: 10 }]);

            await repo.countByUser(TEST_USER_ID, { includeHidden: true });

            expect(mocks.where).toHaveBeenCalledOnce();
        });
    });

    describe('sumStorageByUser', () => {
        it('returns sum of file sizes', async () => {
            mocks.where.mockResolvedValue([{ total: 5000000 }]);

            const result = await repo.sumStorageByUser(TEST_USER_ID);

            expect(result).toBe(5000000);
        });

        it('returns 0 when user has no files', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);

            const result = await repo.sumStorageByUser(TEST_USER_ID);

            expect(result).toBe(0);
        });
    });

    describe('insert', () => {
        it('returns inserted file', async () => {
            const newFile = createNewFileFixture();
            const insertedFile = createFileFixture();
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await repo.insert(newFile);

            expect(result).toEqual(insertedFile);
            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(newFile);
        });
    });

    describe('update', () => {
        it('returns updated file', async () => {
            const updatedFile = createFileFixture({ name: 'new-name.pdf' });
            mocks.returning.mockResolvedValue([updatedFile]);

            const result = await repo.update(TEST_FILE_ID, {
                name: 'new-name.pdf',
            });

            expect(result).toEqual(updatedFile);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith({ name: 'new-name.pdf' });
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.update('nonexistent', {
                name: 'test.pdf',
            });

            expect(result).toBeUndefined();
        });
    });

    describe('delete', () => {
        it('returns deleted file', async () => {
            const deletedFile = createFileFixture();
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await repo.delete(TEST_FILE_ID);

            expect(result).toEqual(deletedFile);
            expect(mocks.delete).toHaveBeenCalledOnce();
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.delete('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('softDelete', () => {
        it('returns soft-deleted file with status and deletedAt', async () => {
            const deletedFile = createFileFixture({
                status: 'deleted',
                deletedAt: new Date(),
            });
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await repo.softDelete(TEST_FILE_ID);

            expect(result).toEqual(deletedFile);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.softDelete('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('softDeleteMany', () => {
        it('returns soft-deleted files', async () => {
            const deletedFiles = [
                createFileFixture({ id: 'file1', status: 'deleted' }),
                createFileFixture({ id: 'file2', status: 'deleted' }),
            ];
            mocks.returning.mockResolvedValue(deletedFiles);

            const result = await repo.softDeleteMany(['file1', 'file2']);

            expect(result).toEqual(deletedFiles);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('returns empty array when given empty array', async () => {
            const result = await repo.softDeleteMany([]);

            expect(result).toEqual([]);
            expect(mocks.update).not.toHaveBeenCalled();
        });

        it('returns empty array when no files match', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.softDeleteMany(['nonexistent']);

            expect(result).toEqual([]);
        });
    });

    describe('softDeleteForUser', () => {
        it('returns soft-deleted files for user', async () => {
            const deletedFiles = [
                createFileFixture({ id: 'file1', status: 'deleted' }),
                createFileFixture({ id: 'file2', status: 'deleted' }),
            ];
            mocks.returning.mockResolvedValue(deletedFiles);

            const result = await repo.softDeleteForUser(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toEqual(deletedFiles);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('returns empty array when given empty array', async () => {
            const result = await repo.softDeleteForUser(TEST_USER_ID, []);

            expect(result).toEqual([]);
            expect(mocks.update).not.toHaveBeenCalled();
        });

        it('returns empty array when no files match user', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await repo.softDeleteForUser(TEST_USER_ID, [
                'nonexistent',
            ]);

            expect(result).toEqual([]);
        });
    });

    describe('findByUserAndBatch', () => {
        it('returns files in the batch owned by user', async () => {
            const files = [
                createFileFixture({ id: 'f1', batchId: TEST_BATCH_ID }),
                createFileFixture({ id: 'f2', batchId: TEST_BATCH_ID }),
            ];
            mocks.files.findMany.mockResolvedValue(files);

            const result = await repo.findByUserAndBatch(
                TEST_USER_ID,
                TEST_BATCH_ID
            );

            expect(result).toEqual(files);
            expect(mocks.files.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when batch has no files for user', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            const result = await repo.findByUserAndBatch(
                TEST_USER_ID,
                TEST_BATCH_ID
            );

            expect(result).toEqual([]);
        });
    });

    describe('findByUserGroupedByBatch', () => {
        it('groups files by batch and emits a null-batchId group for legacy files', async () => {
            const batch = createUploadBatchFixture({
                id: 'batch-1',
                name: 'Silva Wedding',
            });
            const fileInBatch = createFileFixture({
                id: 'f-batched',
                batchId: 'batch-1',
            });
            const orphanFile = createFileFixture({
                id: 'f-legacy',
                batchId: null,
            });
            mocks.orderBy.mockResolvedValue([
                {
                    file: fileInBatch,
                    batchName: batch.name,
                    batchCreatedAt: batch.createdAt,
                },
                {
                    file: orphanFile,
                    batchName: null,
                    batchCreatedAt: null,
                },
            ]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result).toHaveLength(2);
            const named = result.find((g) => g.batchId === 'batch-1');
            expect(named).toBeDefined();
            expect(named!.batchName).toBe('Silva Wedding');
            expect(named!.files).toEqual([fileInBatch]);

            const orphan = result.find((g) => g.batchId === null);
            expect(orphan).toBeDefined();
            expect(orphan!.batchName).toBeNull();
            expect(orphan!.batchCreatedAt).toBeNull();
            expect(orphan!.files).toEqual([orphanFile]);
        });

        it('returns empty array when user has no files', async () => {
            mocks.orderBy.mockResolvedValue([]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result).toEqual([]);
        });

        it('keeps multiple files in a single batch under one group', async () => {
            const batch = createUploadBatchFixture({ id: 'b' });
            const f1 = createFileFixture({ id: 'f1', batchId: 'b' });
            const f2 = createFileFixture({ id: 'f2', batchId: 'b' });
            mocks.orderBy.mockResolvedValue([
                {
                    file: f1,
                    batchName: batch.name,
                    batchCreatedAt: batch.createdAt,
                },
                {
                    file: f2,
                    batchName: batch.name,
                    batchCreatedAt: batch.createdAt,
                },
            ]);

            const result = await repo.findByUserGroupedByBatch(TEST_USER_ID);

            expect(result).toHaveLength(1);
            expect(result[0].files).toEqual([f1, f2]);
        });
    });
});

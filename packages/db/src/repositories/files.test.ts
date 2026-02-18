import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb } from './mocks';
import {
    createFileFixture,
    createNewFileFixture,
    TEST_USER_ID,
    TEST_FILE_ID,
} from './fixtures';
import { createFileRepo } from './files';

describe('files repository', () => {
    let mocks: ReturnType<typeof createMockDb>['mocks'];
    let repo: ReturnType<typeof createFileRepo>;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createFileRepo(mockDb.db);
    });

    describe('findById', () => {
        it('returns file when found', async () => {
            const file = createFileFixture();
            mocks.findFirst.mockResolvedValue(file);

            const result = await repo.findById(TEST_FILE_ID);

            expect(result).toEqual(file);
            expect(mocks.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when not found', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            const result = await repo.findById('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('findByUserAndId', () => {
        it('returns file when user owns it', async () => {
            const file = createFileFixture();
            mocks.findFirst.mockResolvedValue(file);

            const result = await repo.findByUserAndId(
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(file);
            expect(mocks.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when user does not own file', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

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
            mocks.findMany.mockResolvedValue(files);

            const result = await repo.findManyByUserAndIds(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toEqual(files);
            expect(mocks.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty ids', async () => {
            const result = await repo.findManyByUserAndIds(TEST_USER_ID, []);

            expect(result).toEqual([]);
            expect(mocks.findMany).not.toHaveBeenCalled();
        });

        it('returns only files that exist and are owned by user', async () => {
            const files = [createFileFixture({ id: 'file1' })];
            mocks.findMany.mockResolvedValue(files);

            const result = await repo.findManyByUserAndIds(TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toHaveLength(1);
        });
    });

    describe('findByUser', () => {
        it('returns array of files for user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.findMany.mockResolvedValue(files);

            const result = await repo.findByUser(TEST_USER_ID);

            expect(result).toEqual(files);
            expect(result).toHaveLength(2);
        });

        it('uses default pagination (limit: 50, offset: 0)', async () => {
            mocks.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID);

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 50,
                    offset: 0,
                })
            );
        });

        it('respects custom pagination options', async () => {
            mocks.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID, { limit: 10, offset: 20 });

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 10,
                    offset: 20,
                })
            );
        });

        it('returns empty array when user has no files', async () => {
            mocks.findMany.mockResolvedValue([]);

            const result = await repo.findByUser(TEST_USER_ID);

            expect(result).toEqual([]);
        });

        it('respects includeHidden option', async () => {
            mocks.findMany.mockResolvedValue([]);

            await repo.findByUser(TEST_USER_ID, {
                limit: 50,
                offset: 0,
                includeHidden: true,
            });

            // When includeHidden is true, the where clause should only filter by userId
            expect(mocks.findMany).toHaveBeenCalledOnce();
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
});

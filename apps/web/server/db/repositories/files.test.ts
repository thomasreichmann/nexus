import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb } from './mocks';
import {
    createFileFixture,
    createNewFileFixture,
    TEST_USER_ID,
    TEST_FILE_ID,
} from './fixtures';
import {
    findFileById,
    findUserFile,
    findUserFiles,
    findFilesByUser,
    sumStorageBytesByUser,
    insertFile,
    updateFile,
    deleteFile,
    softDeleteFile,
    softDeleteFiles,
} from './files';

describe('files repository', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    describe('findFileById', () => {
        it('returns file when found', async () => {
            const file = createFileFixture();
            mocks.findFirst.mockResolvedValue(file);

            const result = await findFileById(db, TEST_FILE_ID);

            expect(result).toEqual(file);
            expect(mocks.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when not found', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            const result = await findFileById(db, 'nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('findUserFile', () => {
        it('returns file when user owns it', async () => {
            const file = createFileFixture();
            mocks.findFirst.mockResolvedValue(file);

            const result = await findUserFile(db, TEST_USER_ID, TEST_FILE_ID);

            expect(result).toEqual(file);
            expect(mocks.findFirst).toHaveBeenCalledOnce();
        });

        it('returns undefined when user does not own file', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            const result = await findUserFile(db, 'other_user', TEST_FILE_ID);

            expect(result).toBeUndefined();
        });
    });

    describe('findUserFiles', () => {
        it('returns files matching ids owned by user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.findMany.mockResolvedValue(files);

            const result = await findUserFiles(db, TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toEqual(files);
            expect(mocks.findMany).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty ids', async () => {
            const result = await findUserFiles(db, TEST_USER_ID, []);

            expect(result).toEqual([]);
            expect(mocks.findMany).not.toHaveBeenCalled();
        });

        it('returns only files that exist and are owned by user', async () => {
            const files = [createFileFixture({ id: 'file1' })];
            mocks.findMany.mockResolvedValue(files);

            const result = await findUserFiles(db, TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toHaveLength(1);
        });
    });

    describe('findFilesByUser', () => {
        it('returns array of files for user', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2' }),
            ];
            mocks.findMany.mockResolvedValue(files);

            const result = await findFilesByUser(db, TEST_USER_ID);

            expect(result).toEqual(files);
            expect(result).toHaveLength(2);
        });

        it('uses default pagination (limit: 50, offset: 0)', async () => {
            mocks.findMany.mockResolvedValue([]);

            await findFilesByUser(db, TEST_USER_ID);

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 50,
                    offset: 0,
                })
            );
        });

        it('respects custom pagination options', async () => {
            mocks.findMany.mockResolvedValue([]);

            await findFilesByUser(db, TEST_USER_ID, { limit: 10, offset: 20 });

            expect(mocks.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 10,
                    offset: 20,
                })
            );
        });

        it('returns empty array when user has no files', async () => {
            mocks.findMany.mockResolvedValue([]);

            const result = await findFilesByUser(db, TEST_USER_ID);

            expect(result).toEqual([]);
        });

        it('respects includeHidden option', async () => {
            mocks.findMany.mockResolvedValue([]);

            await findFilesByUser(db, TEST_USER_ID, {
                limit: 50,
                offset: 0,
                includeHidden: true,
            });

            // When includeHidden is true, the where clause should only filter by userId
            expect(mocks.findMany).toHaveBeenCalledOnce();
        });
    });

    describe('sumStorageBytesByUser', () => {
        it('returns sum of file sizes', async () => {
            mocks.where.mockResolvedValue([{ total: 5000000 }]);

            const result = await sumStorageBytesByUser(db, TEST_USER_ID);

            expect(result).toBe(5000000);
        });

        it('returns 0 when user has no files', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);

            const result = await sumStorageBytesByUser(db, TEST_USER_ID);

            expect(result).toBe(0);
        });
    });

    describe('insertFile', () => {
        it('returns inserted file', async () => {
            const newFile = createNewFileFixture();
            const insertedFile = createFileFixture();
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await insertFile(db, newFile);

            expect(result).toEqual(insertedFile);
            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(newFile);
        });
    });

    describe('updateFile', () => {
        it('returns updated file', async () => {
            const updatedFile = createFileFixture({ name: 'new-name.pdf' });
            mocks.returning.mockResolvedValue([updatedFile]);

            const result = await updateFile(db, TEST_FILE_ID, {
                name: 'new-name.pdf',
            });

            expect(result).toEqual(updatedFile);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith({ name: 'new-name.pdf' });
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await updateFile(db, 'nonexistent', {
                name: 'test.pdf',
            });

            expect(result).toBeUndefined();
        });
    });

    describe('deleteFile', () => {
        it('returns deleted file', async () => {
            const deletedFile = createFileFixture();
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await deleteFile(db, TEST_FILE_ID);

            expect(result).toEqual(deletedFile);
            expect(mocks.delete).toHaveBeenCalledOnce();
        });

        it('returns undefined when file not found', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await deleteFile(db, 'nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('softDeleteFile', () => {
        it('returns soft-deleted file with status and deletedAt', async () => {
            const deletedFile = createFileFixture({
                status: 'deleted',
                deletedAt: new Date(),
            });
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await softDeleteFile(db, TEST_FILE_ID);

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

            const result = await softDeleteFile(db, 'nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('softDeleteFiles', () => {
        it('returns count of soft-deleted files', async () => {
            mocks.returning.mockResolvedValue([
                { id: 'file1' },
                { id: 'file2' },
            ]);

            const result = await softDeleteFiles(db, ['file1', 'file2']);

            expect(result).toBe(2);
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('returns 0 when given empty array', async () => {
            const result = await softDeleteFiles(db, []);

            expect(result).toBe(0);
            expect(mocks.update).not.toHaveBeenCalled();
        });

        it('returns 0 when no files match', async () => {
            mocks.returning.mockResolvedValue([]);

            const result = await softDeleteFiles(db, ['nonexistent']);

            expect(result).toBe(0);
        });
    });
});

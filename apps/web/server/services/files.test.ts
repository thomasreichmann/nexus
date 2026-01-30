import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createMockDb } from '@/server/db/repositories/mocks';
import {
    createFileFixture,
    TEST_USER_ID,
} from '@/server/db/repositories/fixtures';
import { mockS3 } from '@/lib/storage/testing';
import { NotFoundError, QuotaExceededError } from '@/server/errors';
import { fileService } from './files';

vi.mock('@/lib/storage', () => ({
    s3: mockS3,
}));

describe('files service', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    describe('initiateUpload', () => {
        it('returns fileId, uploadUrl, and expiresAt on success', async () => {
            // Mock sumStorageBytesByUser to return 0 (under quota)
            mocks.where.mockResolvedValue([{ total: 0 }]);
            // Mock insertFile to succeed
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await fileService.initiateUpload(db, TEST_USER_ID, {
                name: 'test.pdf',
                sizeBytes: 1024,
                mimeType: 'application/pdf',
            });

            expect(result).toHaveProperty('fileId');
            expect(result).toHaveProperty('uploadUrl');
            expect(result).toHaveProperty('expiresAt');
            expect(result.uploadUrl).toContain(
                'https://mock-s3.test/test-bucket/'
            );
            expect(result.expiresAt).toBeInstanceOf(Date);
        });

        it('throws QuotaExceededError when storage limit exceeded', async () => {
            // Mock sumStorageBytesByUser to return near max (10GB - 1 byte)
            const tenGBMinus1 = 10 * 1024 * 1024 * 1024 - 1;
            mocks.where.mockResolvedValue([{ total: tenGBMinus1 }]);

            await expect(
                fileService.initiateUpload(db, TEST_USER_ID, {
                    name: 'test.pdf',
                    sizeBytes: 2, // This would exceed quota
                })
            ).rejects.toThrow(QuotaExceededError);
        });

        it('allows upload exactly at quota limit', async () => {
            // Mock sumStorageBytesByUser to return 9GB
            const nineGB = 9 * 1024 * 1024 * 1024;
            mocks.where.mockResolvedValue([{ total: nineGB }]);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            // 1GB file should fit exactly at 10GB limit
            const oneGB = 1 * 1024 * 1024 * 1024;
            const result = await fileService.initiateUpload(db, TEST_USER_ID, {
                name: 'test.pdf',
                sizeBytes: oneGB,
            });

            expect(result).toHaveProperty('fileId');
        });

        it('creates file record with status uploading', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            await fileService.initiateUpload(db, TEST_USER_ID, {
                name: 'test.pdf',
                sizeBytes: 1024,
                mimeType: 'application/pdf',
            });

            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: TEST_USER_ID,
                    name: 'test.pdf',
                    size: 1024,
                    mimeType: 'application/pdf',
                    status: 'uploading',
                })
            );
        });

        it('generates S3 key in correct format', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            await fileService.initiateUpload(db, TEST_USER_ID, {
                name: 'document.pdf',
                sizeBytes: 1024,
            });

            // S3 key format: {userId}/{fileId}/{filename}
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    s3Key: expect.stringMatching(
                        new RegExp(
                            `^${TEST_USER_ID}/[0-9a-f-]+/document\\.pdf$`
                        )
                    ),
                })
            );
        });
    });

    describe('confirmUpload', () => {
        it('returns file with status available', async () => {
            const uploadingFile = createFileFixture({ status: 'uploading' });
            const availableFile = createFileFixture({ status: 'available' });
            mocks.findFirst.mockResolvedValue(uploadingFile);
            mocks.returning.mockResolvedValue([availableFile]);

            const result = await fileService.confirmUpload(
                db,
                TEST_USER_ID,
                uploadingFile.id
            );

            expect(result.file).toEqual(availableFile);
            expect(mocks.set).toHaveBeenCalledWith({ status: 'available' });
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.confirmUpload(db, TEST_USER_ID, 'nonexistent-id')
            ).rejects.toThrow(NotFoundError);
        });

        it('throws NotFoundError when file belongs to different user', async () => {
            // findUserFile returns undefined when user doesn't own file
            mocks.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.confirmUpload(db, 'different-user', 'some-file-id')
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('deleteUserFile', () => {
        it('returns soft-deleted file on success', async () => {
            const file = createFileFixture({ status: 'available' });
            const deletedFile = createFileFixture({
                status: 'deleted',
                deletedAt: new Date(),
            });

            mocks.findFirst.mockResolvedValue(file);
            mocks.returning.mockResolvedValue([deletedFile]);

            const result = await fileService.deleteUserFile(
                db,
                TEST_USER_ID,
                file.id
            );

            expect(result.status).toBe('deleted');
            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.deleteUserFile(db, TEST_USER_ID, 'nonexistent-id')
            ).rejects.toThrow(NotFoundError);
        });

        it('throws NotFoundError when user does not own file', async () => {
            mocks.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.deleteUserFile(db, 'other-user', 'some-file-id')
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('deleteUserFiles', () => {
        it('returns soft-deleted files on success', async () => {
            const deletedFiles = [
                createFileFixture({ id: 'file1', status: 'deleted' }),
                createFileFixture({ id: 'file2', status: 'deleted' }),
            ];
            mocks.returning.mockResolvedValue(deletedFiles);

            const result = await fileService.deleteUserFiles(db, TEST_USER_ID, [
                'file1',
                'file2',
            ]);

            expect(result).toHaveLength(2);
            expect(result[0].status).toBe('deleted');
            expect(result[1].status).toBe('deleted');
            expect(mocks.update).toHaveBeenCalledOnce();
        });

        it('returns empty array when given empty ids', async () => {
            const result = await fileService.deleteUserFiles(
                db,
                TEST_USER_ID,
                []
            );

            expect(result).toEqual([]);
            expect(mocks.update).not.toHaveBeenCalled();
        });

        it('throws NotFoundError when any file is not owned by user', async () => {
            // Only file1 is deleted (file2 not owned by user)
            const deletedFiles = [
                createFileFixture({ id: 'file1', status: 'deleted' }),
            ];
            mocks.returning.mockResolvedValue(deletedFiles);

            await expect(
                fileService.deleteUserFiles(db, TEST_USER_ID, [
                    'file1',
                    'file2',
                ])
            ).rejects.toThrow(NotFoundError);
        });

        it('throws NotFoundError when any file does not exist', async () => {
            mocks.returning.mockResolvedValue([]);

            await expect(
                fileService.deleteUserFiles(db, TEST_USER_ID, ['nonexistent'])
            ).rejects.toThrow(NotFoundError);
        });
    });
});

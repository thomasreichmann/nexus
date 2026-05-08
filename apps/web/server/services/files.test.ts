import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createFileFixture,
    createStorageUsageFixture,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { mockS3 } from '@/lib/storage/testing';
import {
    NotFoundError,
    QuotaExceededError,
    InvalidStateError,
} from '@/server/errors';
import { fileService } from './files';
import { PLAN_LIMITS } from './constants';

vi.mock('@/lib/storage', () => ({
    s3: mockS3,
}));

describe('files service', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    function mockUsage(usedBytes = 0) {
        mocks.storageUsage.findFirst.mockResolvedValue(
            createStorageUsageFixture({ usedBytes })
        );
    }

    describe('initiateUpload', () => {
        it('returns fileId, uploadUrl, and expiresAt on success', async () => {
            mockUsage(0);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'test.pdf',
                    sizeBytes: 1024,
                    mimeType: 'application/pdf',
                },
                undefined
            );

            expect(result).toHaveProperty('fileId');
            expect(result).toHaveProperty('uploadUrl');
            expect(result).toHaveProperty('expiresAt');
            expect(result.uploadUrl).toContain(
                'https://mock-s3.test/test-bucket/'
            );
            expect(result.expiresAt).toBeInstanceOf(Date);
        });

        // Smoke test that quota rejection wires through — full branch
        // coverage lives in quota.test.ts.
        it('surfaces QuotaExceededError from the quota check', async () => {
            // Already at 110% of the starter limit — well past the 105% soft cap.
            mockUsage(Math.floor(PLAN_LIMITS.starter * 1.1));

            await expect(
                fileService.initiateUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'test.pdf',
                        sizeBytes: 1,
                    },
                    undefined
                )
            ).rejects.toThrow(QuotaExceededError);
        });

        it('creates file record with status uploading', async () => {
            mockUsage(0);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'test.pdf',
                    sizeBytes: 1024,
                    mimeType: 'application/pdf',
                },
                undefined
            );

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
            mockUsage(0);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'document.pdf',
                    sizeBytes: 1024,
                },
                undefined
            );

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
        it('returns file with status available and increments usage', async () => {
            const uploadingFile = createFileFixture({
                status: 'uploading',
                size: 4096,
            });
            const availableFile = createFileFixture({
                ...uploadingFile,
                status: 'available',
            });
            mocks.files.findFirst.mockResolvedValue(uploadingFile);
            // Two .returning() calls: file update, then usage upsert.
            mocks.returning
                .mockResolvedValueOnce([availableFile])
                .mockResolvedValueOnce([
                    createStorageUsageFixture({ usedBytes: 4096 }),
                ]);

            const result = await fileService.confirmUpload(
                db,
                TEST_USER_ID,
                uploadingFile.id
            );

            expect(result.file).toEqual(availableFile);
            expect(mocks.set).toHaveBeenCalledWith({ status: 'available' });
            // Increment usage upserts via `insert + onConflictDoUpdate`.
            expect(mocks.onConflictDoUpdate).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: TEST_USER_ID,
                    usedBytes: 4096,
                    fileCount: 1,
                })
            );
        });

        it('is a no-op when the file is already available (no double-count)', async () => {
            const availableFile = createFileFixture({ status: 'available' });
            mocks.files.findFirst.mockResolvedValue(availableFile);

            const result = await fileService.confirmUpload(
                db,
                TEST_USER_ID,
                availableFile.id
            );

            expect(result.file).toEqual(availableFile);
            expect(mocks.update).not.toHaveBeenCalled();
            expect(mocks.onConflictDoUpdate).not.toHaveBeenCalled();
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.confirmUpload(db, TEST_USER_ID, 'nonexistent-id')
            ).rejects.toThrow(NotFoundError);
        });

        it('throws NotFoundError when file belongs to different user', async () => {
            // findByUserAndId scopes by both ids, so a wrong user returns undefined
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.confirmUpload(db, 'different-user', 'some-file-id')
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('deleteUserFile', () => {
        describe('single file', () => {
            it('returns soft-deleted file and decrements usage', async () => {
                const file = createFileFixture({
                    status: 'available',
                    size: 2048,
                });
                const deletedFile = createFileFixture({
                    ...file,
                    status: 'deleted',
                    deletedAt: new Date(),
                });

                mocks.files.findMany.mockResolvedValue([file]);
                mocks.returning
                    .mockResolvedValueOnce([deletedFile])
                    .mockResolvedValueOnce([
                        createStorageUsageFixture({ usedBytes: 0 }),
                    ]);

                const result = await fileService.deleteUserFile(
                    db,
                    TEST_USER_ID,
                    deletedFile.id
                );

                expect(result.status).toBe('deleted');
                expect(mocks.update).toHaveBeenCalledTimes(2); // file + usage
                expect(mocks.set).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: 'deleted',
                        deletedAt: expect.any(Date),
                    })
                );
            });

            it('skips usage decrement for files still in `uploading`', async () => {
                const uploadingFile = createFileFixture({
                    status: 'uploading',
                    size: 2048,
                });
                const deletedFile = createFileFixture({
                    ...uploadingFile,
                    status: 'deleted',
                    deletedAt: new Date(),
                });

                mocks.files.findMany.mockResolvedValue([uploadingFile]);
                mocks.returning.mockResolvedValueOnce([deletedFile]);

                await fileService.deleteUserFile(
                    db,
                    TEST_USER_ID,
                    deletedFile.id
                );

                // Only the file update — no usage decrement.
                expect(mocks.update).toHaveBeenCalledTimes(1);
            });

            it('throws NotFoundError when file does not exist', async () => {
                mocks.files.findMany.mockResolvedValue([]);
                mocks.returning.mockResolvedValue([]);

                await expect(
                    fileService.deleteUserFile(
                        db,
                        TEST_USER_ID,
                        'nonexistent-id'
                    )
                ).rejects.toThrow(NotFoundError);
            });

            it('throws NotFoundError when user does not own file', async () => {
                mocks.files.findMany.mockResolvedValue([]);
                mocks.returning.mockResolvedValue([]);

                await expect(
                    fileService.deleteUserFile(db, 'other-user', 'some-file-id')
                ).rejects.toThrow(NotFoundError);
            });

            it('throws NotFoundError when file is already deleted', async () => {
                // WHERE clause excludes status='deleted', so update returns 0 rows
                mocks.files.findMany.mockResolvedValue([]);
                mocks.returning.mockResolvedValue([]);

                await expect(
                    fileService.deleteUserFile(
                        db,
                        TEST_USER_ID,
                        'already-deleted-id'
                    )
                ).rejects.toThrow(NotFoundError);
            });
        });

        describe('multiple files', () => {
            it('returns soft-deleted files on success', async () => {
                const beforeFiles = [
                    createFileFixture({
                        id: 'file1',
                        status: 'available',
                        size: 100,
                    }),
                    createFileFixture({
                        id: 'file2',
                        status: 'available',
                        size: 200,
                    }),
                ];
                const deletedFiles = beforeFiles.map((f) =>
                    createFileFixture({ ...f, status: 'deleted' })
                );

                mocks.files.findMany.mockResolvedValue(beforeFiles);
                mocks.returning
                    .mockResolvedValueOnce(deletedFiles)
                    .mockResolvedValueOnce([createStorageUsageFixture()]);

                const result = await fileService.deleteUserFile(
                    db,
                    TEST_USER_ID,
                    ['file1', 'file2']
                );

                expect(result).toHaveLength(2);
                expect(result[0].status).toBe('deleted');
                expect(result[1].status).toBe('deleted');
                // softDelete + a single batched usage decrement.
                expect(mocks.update).toHaveBeenCalledTimes(2);
            });

            it('returns empty array when given empty ids', async () => {
                const result = await fileService.deleteUserFile(
                    db,
                    TEST_USER_ID,
                    []
                );

                expect(result).toEqual([]);
                expect(mocks.update).not.toHaveBeenCalled();
            });

            it('throws NotFoundError when any file is not owned by user', async () => {
                // Only file1 was deleted (file2 not owned by user)
                const file1 = createFileFixture({
                    id: 'file1',
                    status: 'available',
                });
                mocks.files.findMany.mockResolvedValue([file1]);
                mocks.returning.mockResolvedValue([
                    createFileFixture({ id: 'file1', status: 'deleted' }),
                ]);

                await expect(
                    fileService.deleteUserFile(db, TEST_USER_ID, [
                        'file1',
                        'file2',
                    ])
                ).rejects.toThrow(NotFoundError);
            });

            it('throws NotFoundError when any file does not exist', async () => {
                mocks.files.findMany.mockResolvedValue([]);
                mocks.returning.mockResolvedValue([]);

                await expect(
                    fileService.deleteUserFile(db, TEST_USER_ID, [
                        'nonexistent',
                    ])
                ).rejects.toThrow(NotFoundError);
            });
        });
    });

    describe('initiateMultipartUpload', () => {
        it('returns fileId, uploadId, partUrls, chunkSize, and expiresAt', async () => {
            mockUsage(0);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await fileService.initiateMultipartUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'large-file.zip',
                    sizeBytes: 50 * 1024 * 1024, // 50MB = 5 parts
                    mimeType: 'application/zip',
                },
                undefined
            );

            expect(result).toHaveProperty('fileId');
            expect(result).toHaveProperty('uploadId', 'mock-upload-id');
            expect(result.partUrls).toHaveLength(5);
            expect(result.chunkSize).toBe(10 * 1024 * 1024);
            expect(result.expiresAt).toBeInstanceOf(Date);
        });

        // Smoke test — quota logic itself is covered in quota.test.ts.
        it('surfaces QuotaExceededError from the quota check', async () => {
            mockUsage(Math.floor(PLAN_LIMITS.starter * 1.1));

            await expect(
                fileService.initiateMultipartUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'large-file.zip',
                        sizeBytes: 1,
                    },
                    undefined
                )
            ).rejects.toThrow(QuotaExceededError);
        });

        it('creates file record with status uploading', async () => {
            mockUsage(0);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            await fileService.initiateMultipartUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'large-file.zip',
                    sizeBytes: 50 * 1024 * 1024,
                },
                undefined
            );

            expect(mocks.insert).toHaveBeenCalledOnce();
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: TEST_USER_ID,
                    name: 'large-file.zip',
                    status: 'uploading',
                })
            );
        });

        it('calculates correct part count for exact chunk boundary', async () => {
            mockUsage(0);
            const insertedFile = createFileFixture({ status: 'uploading' });
            mocks.returning.mockResolvedValue([insertedFile]);

            const result = await fileService.initiateMultipartUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'exact.bin',
                    sizeBytes: 20 * 1024 * 1024, // exactly 2 chunks
                },
                undefined
            );

            expect(result.partUrls).toHaveLength(2);
        });
    });

    describe('completeMultipartUpload', () => {
        it('transitions file to available status and increments usage', async () => {
            const uploadingFile = createFileFixture({
                status: 'uploading',
                size: 1000,
            });
            const availableFile = createFileFixture({
                ...uploadingFile,
                status: 'available',
            });
            mocks.files.findFirst.mockResolvedValue(uploadingFile);
            mocks.returning
                .mockResolvedValueOnce([availableFile])
                .mockResolvedValueOnce([
                    createStorageUsageFixture({ usedBytes: 1000 }),
                ]);

            const result = await fileService.completeMultipartUpload(
                db,
                TEST_USER_ID,
                {
                    fileId: uploadingFile.id,
                    uploadId: 'some-upload-id',
                    parts: [{ partNumber: 1, etag: '"abc123"' }],
                }
            );

            expect(result.file.status).toBe('available');
            expect(mocks.set).toHaveBeenCalledWith({ status: 'available' });
            expect(mocks.onConflictDoUpdate).toHaveBeenCalledOnce();
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.completeMultipartUpload(db, TEST_USER_ID, {
                    fileId: 'nonexistent',
                    uploadId: 'some-upload-id',
                    parts: [{ partNumber: 1, etag: '"abc"' }],
                })
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when file is not uploading', async () => {
            const availableFile = createFileFixture({ status: 'available' });
            mocks.files.findFirst.mockResolvedValue(availableFile);

            await expect(
                fileService.completeMultipartUpload(db, TEST_USER_ID, {
                    fileId: availableFile.id,
                    uploadId: 'some-upload-id',
                    parts: [{ partNumber: 1, etag: '"abc"' }],
                })
            ).rejects.toThrow(InvalidStateError);
        });
    });

    describe('abortMultipartUpload', () => {
        it('soft-deletes the file record', async () => {
            const uploadingFile = createFileFixture({ status: 'uploading' });
            mocks.files.findFirst.mockResolvedValue(uploadingFile);
            mocks.returning.mockResolvedValue([
                { ...uploadingFile, status: 'deleted' },
            ]);

            await fileService.abortMultipartUpload(
                db,
                TEST_USER_ID,
                uploadingFile.id,
                'some-upload-id'
            );

            expect(mocks.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'deleted',
                    deletedAt: expect.any(Date),
                })
            );
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.abortMultipartUpload(
                    db,
                    TEST_USER_ID,
                    'nonexistent',
                    'some-upload-id'
                )
            ).rejects.toThrow(NotFoundError);
        });
    });
});

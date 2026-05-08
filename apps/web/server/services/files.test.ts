import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createFileFixture,
    createUploadBatchFixture,
    TEST_BATCH_ID,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { mockS3 } from '@/lib/storage/testing';
import {
    NotFoundError,
    QuotaExceededError,
    InvalidStateError,
} from '@/server/errors';
import { fileService, formatFallbackBatchName } from './files';
import { PLAN_LIMITS } from './constants';

vi.mock('@/lib/storage', () => ({
    s3: mockS3,
}));

describe('files service', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    // Returning mock is shared across .returning() calls. Without an explicit
    // batchId the service inserts the batch row first, then the file row, so
    // each insert gets the next mocked result.
    function mockBatchAndFileInserts() {
        const batch = createUploadBatchFixture();
        const insertedFile = createFileFixture({ status: 'uploading' });
        mocks.returning
            .mockResolvedValueOnce([batch])
            .mockResolvedValueOnce([insertedFile]);
        return { batch, insertedFile };
    }

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
            mockBatchAndFileInserts();

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
            mocks.where.mockResolvedValue([{ total: PLAN_LIMITS.starter }]);

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
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mockBatchAndFileInserts();

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

            // Two inserts now: one for the auto-created batch, one for the file.
            expect(mocks.insert).toHaveBeenCalledTimes(2);
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
            mockBatchAndFileInserts();

            await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'document.pdf',
                    sizeBytes: 1024,
                },
                undefined
            );

            // S3 key format: {userId}/{batchId}/{fileId}/{filename}
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    s3Key: expect.stringMatching(
                        new RegExp(
                            `^${TEST_USER_ID}/[^/]+/[^/]+/document\\.pdf$`
                        )
                    ),
                })
            );
        });

        it('auto-creates a batch with fallback name when batchId omitted', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mockBatchAndFileInserts();

            await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                { name: 'a.pdf', sizeBytes: 1 },
                undefined
            );

            // First values() call is the batch insert; the name should be the
            // fallback formatter output ("Upload <date> <time>").
            expect(mocks.values).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    userId: TEST_USER_ID,
                    name: expect.stringMatching(/^Upload \d{4}-\d{2}-\d{2}/),
                })
            );
        });

        it('uses caller-supplied batchName when batchId omitted', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mockBatchAndFileInserts();

            await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                { name: 'a.pdf', sizeBytes: 1, batchName: 'Silva Wedding' },
                undefined
            );

            expect(mocks.values).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ name: 'Silva Wedding' })
            );
        });

        it('reuses an existing batch when batchId provided and owned', async () => {
            const batch = createUploadBatchFixture();
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.returning.mockResolvedValueOnce([
                createFileFixture({ status: 'uploading' }),
            ]);

            await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                { name: 'a.pdf', sizeBytes: 1, batchId: batch.id },
                undefined
            );

            // No second batch insert — only the file insert.
            expect(mocks.insert).toHaveBeenCalledTimes(1);
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ batchId: batch.id })
            );
        });

        it('throws NotFoundError when batchId not owned by user', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mocks.uploadBatches.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.initiateUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'a.pdf',
                        sizeBytes: 1,
                        batchId: TEST_BATCH_ID,
                    },
                    undefined
                )
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('formatFallbackBatchName', () => {
        it('formats UTC timestamp at minute precision', () => {
            // 2026-05-08T14:32:11.000Z
            const date = new Date(Date.UTC(2026, 4, 8, 14, 32, 11));
            expect(formatFallbackBatchName(date)).toBe(
                'Upload 2026-05-08 14:32'
            );
        });

        it('is locale-free (always UTC)', () => {
            const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
            expect(formatFallbackBatchName(date)).toBe(
                'Upload 2026-01-01 00:00'
            );
        });
    });

    describe('confirmUpload', () => {
        it('returns file with status available', async () => {
            const uploadingFile = createFileFixture({ status: 'uploading' });
            const availableFile = createFileFixture({ status: 'available' });
            mocks.files.findFirst.mockResolvedValue(uploadingFile);
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
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.confirmUpload(db, TEST_USER_ID, 'nonexistent-id')
            ).rejects.toThrow(NotFoundError);
        });

        it('throws NotFoundError when file belongs to different user', async () => {
            // findUserFile returns undefined when user doesn't own file
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                fileService.confirmUpload(db, 'different-user', 'some-file-id')
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('deleteUserFile', () => {
        describe('single file', () => {
            it('returns soft-deleted file on success', async () => {
                const deletedFile = createFileFixture({
                    status: 'deleted',
                    deletedAt: new Date(),
                });

                mocks.returning.mockResolvedValue([deletedFile]);

                const result = await fileService.deleteUserFile(
                    db,
                    TEST_USER_ID,
                    deletedFile.id
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
                mocks.returning.mockResolvedValue([]);

                await expect(
                    fileService.deleteUserFile(db, 'other-user', 'some-file-id')
                ).rejects.toThrow(NotFoundError);
            });

            it('throws NotFoundError when file is already deleted', async () => {
                // WHERE clause excludes status='deleted', so update returns 0 rows
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
                const deletedFiles = [
                    createFileFixture({ id: 'file1', status: 'deleted' }),
                    createFileFixture({ id: 'file2', status: 'deleted' }),
                ];
                mocks.returning.mockResolvedValue(deletedFiles);

                const result = await fileService.deleteUserFile(
                    db,
                    TEST_USER_ID,
                    ['file1', 'file2']
                );

                expect(result).toHaveLength(2);
                expect(result[0].status).toBe('deleted');
                expect(result[1].status).toBe('deleted');
                expect(mocks.update).toHaveBeenCalledOnce();
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
                // Only file1 is deleted (file2 not owned by user)
                const deletedFiles = [
                    createFileFixture({ id: 'file1', status: 'deleted' }),
                ];
                mocks.returning.mockResolvedValue(deletedFiles);

                await expect(
                    fileService.deleteUserFile(db, TEST_USER_ID, [
                        'file1',
                        'file2',
                    ])
                ).rejects.toThrow(NotFoundError);
            });

            it('throws NotFoundError when any file does not exist', async () => {
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
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mockBatchAndFileInserts();

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
            mocks.where.mockResolvedValue([{ total: PLAN_LIMITS.starter }]);

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
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mockBatchAndFileInserts();

            await fileService.initiateMultipartUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'large-file.zip',
                    sizeBytes: 50 * 1024 * 1024,
                },
                undefined
            );

            // Two inserts: batch + file
            expect(mocks.insert).toHaveBeenCalledTimes(2);
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: TEST_USER_ID,
                    name: 'large-file.zip',
                    status: 'uploading',
                })
            );
        });

        it('calculates correct part count for exact chunk boundary', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mockBatchAndFileInserts();

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
        it('transitions file to available status', async () => {
            const uploadingFile = createFileFixture({ status: 'uploading' });
            const availableFile = createFileFixture({ status: 'available' });
            mocks.files.findFirst.mockResolvedValue(uploadingFile);
            mocks.returning.mockResolvedValue([availableFile]);

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

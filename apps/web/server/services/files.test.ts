import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createFileFixture,
    createSubscriptionFixture,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { mockS3 } from '@/lib/storage/testing';
import {
    NotFoundError,
    QuotaExceededError,
    InvalidStateError,
    TrialExpiredError,
} from '@/server/errors';
import { fileService } from './files';

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

    describe('initiateUpload', () => {
        it('returns fileId, uploadUrl, and expiresAt on success', async () => {
            // Mock sumStorageBytesByUser to return 0 (under quota)
            mocks.where.mockResolvedValue([{ total: 0 }]);
            // Mock insertFile to succeed
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

        it('throws QuotaExceededError when storage limit exceeded', async () => {
            // Mock sumStorageBytesByUser to return near max (10GB - 1 byte)
            const tenGBMinus1 = 10 * 1024 * 1024 * 1024 - 1;
            mocks.where.mockResolvedValue([{ total: tenGBMinus1 }]);

            await expect(
                fileService.initiateUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'test.pdf',
                        sizeBytes: 2, // This would exceed quota
                    },
                    undefined
                )
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
            const result = await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'test.pdf',
                    sizeBytes: oneGB,
                },
                undefined
            );

            expect(result).toHaveProperty('fileId');
        });

        it('creates file record with status uploading', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
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
            mocks.where.mockResolvedValue([{ total: 0 }]);
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

    describe('quota enforcement with subscription', () => {
        const oneGB = 1024 ** 3;
        const hundredGB = 100 * 1024 ** 3;

        it('uses subscription storageLimit instead of starter default', async () => {
            // Pro subscription with 100 GB limit — user is already at 50 GB
            const sub = createSubscriptionFixture({
                planTier: 'pro',
                status: 'active',
                storageLimit: hundredGB,
            });
            mocks.where.mockResolvedValue([{ total: 50 * oneGB }]);
            mocks.returning.mockResolvedValue([createFileFixture()]);

            // 40 GB upload would exceed starter (10 GB) but fits in pro (100 GB)
            const result = await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'big.bin',
                    sizeBytes: 40 * oneGB,
                },
                sub
            );

            expect(result).toHaveProperty('fileId');
        });

        it('throws QuotaExceededError when over subscription limit', async () => {
            const sub = createSubscriptionFixture({
                planTier: 'pro',
                status: 'active',
                storageLimit: hundredGB,
            });
            // At 99 GB, a 2 GB upload would exceed the 100 GB limit
            mocks.where.mockResolvedValue([{ total: 99 * oneGB }]);

            await expect(
                fileService.initiateUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'overflow.bin',
                        sizeBytes: 2 * oneGB,
                    },
                    sub
                )
            ).rejects.toThrow(QuotaExceededError);
        });

        it('allows upload during active trial within quota', async () => {
            const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
            const sub = createSubscriptionFixture({
                status: 'trialing',
                trialEnd: future,
            });
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mocks.returning.mockResolvedValue([createFileFixture()]);

            const result = await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'trial.pdf',
                    sizeBytes: 1024,
                },
                sub
            );

            expect(result).toHaveProperty('fileId');
        });

        it('throws TrialExpiredError when trial has ended', async () => {
            const past = new Date(Date.now() - 24 * 60 * 60 * 1000); // -1 day
            const sub = createSubscriptionFixture({
                status: 'trialing',
                trialEnd: past,
            });
            mocks.where.mockResolvedValue([{ total: 0 }]);

            await expect(
                fileService.initiateUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'expired.pdf',
                        sizeBytes: 1024,
                    },
                    sub
                )
            ).rejects.toThrow(TrialExpiredError);
        });

        it('prefers TrialExpiredError over QuotaExceededError when both apply', async () => {
            // Expired trial AND over quota — trial check must run first
            const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const sub = createSubscriptionFixture({
                status: 'trialing',
                trialEnd: past,
                storageLimit: oneGB,
            });
            mocks.where.mockResolvedValue([{ total: oneGB }]); // already at quota

            await expect(
                fileService.initiateUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'double-fail.pdf',
                        sizeBytes: 1024,
                    },
                    sub
                )
            ).rejects.toThrow(TrialExpiredError);
        });

        it('ignores trialEnd when status is not trialing', async () => {
            // Active sub with a stale trialEnd in the past — should not throw
            const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const sub = createSubscriptionFixture({
                status: 'active',
                trialEnd: past,
            });
            mocks.where.mockResolvedValue([{ total: 0 }]);
            mocks.returning.mockResolvedValue([createFileFixture()]);

            const result = await fileService.initiateUpload(
                db,
                TEST_USER_ID,
                {
                    name: 'active.pdf',
                    sizeBytes: 1024,
                },
                sub
            );

            expect(result).toHaveProperty('fileId');
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

        it('throws QuotaExceededError when storage limit exceeded', async () => {
            const tenGBMinus1 = 10 * 1024 * 1024 * 1024 - 1;
            mocks.where.mockResolvedValue([{ total: tenGBMinus1 }]);

            await expect(
                fileService.initiateMultipartUpload(
                    db,
                    TEST_USER_ID,
                    {
                        name: 'large-file.zip',
                        sizeBytes: 2,
                    },
                    undefined
                )
            ).rejects.toThrow(QuotaExceededError);
        });

        it('creates file record with status uploading', async () => {
            mocks.where.mockResolvedValue([{ total: 0 }]);
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
            mocks.where.mockResolvedValue([{ total: 0 }]);
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

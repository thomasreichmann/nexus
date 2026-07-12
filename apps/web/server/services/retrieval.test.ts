import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createFileFixture,
    createRetrievalFixture,
    createUploadBatchFixture,
    TEST_BATCH_ID,
    TEST_USER_ID,
    TEST_FILE_ID,
} from '@nexus/db/testing';
import { mockS3 } from '@/lib/storage/testing';
import { NotFoundError, InvalidStateError } from '@/server/errors';
import { retrievalService } from './retrieval';

vi.mock('@/lib/storage', () => ({
    s3: mockS3,
}));

describe('retrieval service', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    describe('requestRetrieval', () => {
        it('creates retrieval for Glacier file', async () => {
            const file = createFileFixture({ storageTier: 'glacier' });
            const retrieval = createRetrievalFixture();

            // requestRetrieval delegates to requestBulkRetrieval:
            // findUserFiles -> findByFileIds -> s3.glacier.restoreMany -> insertMany
            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([retrieval]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID,
                'standard'
            );

            expect(result).toEqual(retrieval);
            expect(mocks.insert).toHaveBeenCalledOnce();
        });

        it('creates retrieval for deep_archive file', async () => {
            const file = createFileFixture({ storageTier: 'deep_archive' });
            const retrieval = createRetrievalFixture({ tier: 'bulk' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([retrieval]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID,
                'bulk'
            );

            expect(result).toEqual(retrieval);
        });

        it('returns existing active retrieval (idempotent)', async () => {
            const file = createFileFixture({ storageTier: 'glacier' });
            const existing = createRetrievalFixture({ status: 'pending' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([existing]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(existing);
            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.files.findMany.mockResolvedValue([]);

            await expect(
                retrievalService.requestRetrieval(
                    db,
                    TEST_USER_ID,
                    'nonexistent'
                )
            ).rejects.toThrow(NotFoundError);
        });

        it('marks standard-tier file ready immediately without calling RestoreObject', async () => {
            const restoreManySpy = vi.spyOn(mockS3.glacier, 'restoreMany');
            const file = createFileFixture({ storageTier: 'standard' });
            const retrieval = createRetrievalFixture({ status: 'ready' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([retrieval]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(retrieval);
            expect(restoreManySpy).not.toHaveBeenCalled();
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    status: 'ready',
                    readyAt: expect.any(Date),
                    expiresAt: expect.any(Date),
                }),
            ]);
        });

        it('throws InvalidStateError when file is not available', async () => {
            const file = createFileFixture({ status: 'uploading' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);

            await expect(
                retrievalService.requestRetrieval(
                    db,
                    TEST_USER_ID,
                    TEST_FILE_ID
                )
            ).rejects.toThrow(InvalidStateError);
        });

        it('expires lapsed ready rows before inserting', async () => {
            const file = createFileFixture({ storageTier: 'standard' });
            const retrieval = createRetrievalFixture({ status: 'ready' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([retrieval]);

            await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(mocks.update).toHaveBeenCalledOnce();
            expect(mocks.set).toHaveBeenCalledWith({ status: 'expired' });
        });

        it('returns the surviving row when a concurrent request wins the insert race', async () => {
            const file = createFileFixture({ storageTier: 'standard' });
            const survivor = createRetrievalFixture({ status: 'ready' });

            mocks.files.findMany.mockResolvedValue([file]);
            // First findMany: the pre-insert active check sees nothing; the
            // competing request inserts between check and insert, so the
            // conflict-skipped insert returns [] and the reconciliation
            // lookup finds the winner's row.
            mocks.retrievals.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([survivor]);
            mocks.returning.mockResolvedValue([]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(survivor);
            expect(mocks.retrievals.findMany).toHaveBeenCalledTimes(2);
        });
    });

    describe('requestBulkRetrieval', () => {
        it('creates retrievals for multiple files', async () => {
            const files = [
                createFileFixture({
                    id: 'file1',
                    s3Key: 'user/file1',
                    storageTier: 'glacier',
                }),
                createFileFixture({
                    id: 'file2',
                    s3Key: 'user/file2',
                    storageTier: 'glacier',
                }),
            ];
            const newRetrievals = [
                createRetrievalFixture({ id: 'r1', fileId: 'file1' }),
                createRetrievalFixture({ id: 'r2', fileId: 'file2' }),
            ];

            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue(newRetrievals);

            const result = await retrievalService.requestBulkRetrieval(
                db,
                TEST_USER_ID,
                ['file1', 'file2'],
                'standard'
            );

            expect(result).toHaveLength(2);
            expect(mocks.insert).toHaveBeenCalledOnce();
        });

        it('returns existing retrievals for files with active retrievals', async () => {
            const files = [
                createFileFixture({
                    id: 'file1',
                    s3Key: 'user/file1',
                    storageTier: 'glacier',
                }),
                createFileFixture({
                    id: 'file2',
                    s3Key: 'user/file2',
                    storageTier: 'glacier',
                }),
            ];
            const existingRetrieval = createRetrievalFixture({
                id: 'r1',
                fileId: 'file1',
                status: 'in_progress',
            });
            const newRetrieval = createRetrievalFixture({
                id: 'r2',
                fileId: 'file2',
            });

            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([existingRetrieval]);
            mocks.returning.mockResolvedValue([newRetrieval]);

            const result = await retrievalService.requestBulkRetrieval(
                db,
                TEST_USER_ID,
                ['file1', 'file2']
            );

            expect(result).toHaveLength(2);
        });

        it('throws NotFoundError when any file is missing', async () => {
            const files = [createFileFixture({ id: 'file1' })];
            mocks.files.findMany.mockResolvedValue(files);

            await expect(
                retrievalService.requestBulkRetrieval(db, TEST_USER_ID, [
                    'file1',
                    'file2',
                ])
            ).rejects.toThrow(NotFoundError);
        });

        it('restores only archived files in a mixed-tier request; standard files are ready immediately', async () => {
            const restoreManySpy = vi.spyOn(mockS3.glacier, 'restoreMany');
            const files = [
                createFileFixture({
                    id: 'file1',
                    s3Key: 'user/file1',
                    storageTier: 'glacier',
                }),
                createFileFixture({
                    id: 'file2',
                    s3Key: 'user/file2',
                    storageTier: 'standard',
                }),
            ];
            const newRetrievals = [
                createRetrievalFixture({ id: 'r1', fileId: 'file1' }),
                createRetrievalFixture({
                    id: 'r2',
                    fileId: 'file2',
                    status: 'ready',
                }),
            ];

            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue(newRetrievals);

            const result = await retrievalService.requestBulkRetrieval(
                db,
                TEST_USER_ID,
                ['file1', 'file2'],
                'standard'
            );

            expect(result).toHaveLength(2);
            expect(restoreManySpy).toHaveBeenCalledExactlyOnceWith(
                ['user/file1'],
                'standard',
                expect.any(Number)
            );
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    fileId: 'file1',
                    status: 'pending',
                }),
                expect.objectContaining({
                    fileId: 'file2',
                    status: 'ready',
                    readyAt: expect.any(Date),
                    expiresAt: expect.any(Date),
                }),
            ]);
        });

        it('throws InvalidStateError when any file is not available', async () => {
            const files = [
                createFileFixture({
                    id: 'file1',
                    storageTier: 'glacier',
                }),
                createFileFixture({
                    id: 'file2',
                    status: 'deleted',
                }),
            ];

            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([]);

            await expect(
                retrievalService.requestBulkRetrieval(db, TEST_USER_ID, [
                    'file1',
                    'file2',
                ])
            ).rejects.toThrow(InvalidStateError);
        });

        it('returns only existing retrievals when all files already have active retrievals', async () => {
            const files = [
                createFileFixture({ id: 'file1', storageTier: 'glacier' }),
            ];
            const existingRetrieval = createRetrievalFixture({
                id: 'r1',
                fileId: 'file1',
                status: 'ready',
            });

            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([existingRetrieval]);

            const result = await retrievalService.requestBulkRetrieval(
                db,
                TEST_USER_ID,
                ['file1']
            );

            expect(result).toEqual([existingRetrieval]);
            expect(mocks.insert).not.toHaveBeenCalled();
        });
    });

    describe('requestBatchRetrieval', () => {
        it('creates retrievals for all files in the batch with shared batchId', async () => {
            const batch = createUploadBatchFixture();
            const files = [
                createFileFixture({
                    id: 'f1',
                    batchId: batch.id,
                    storageTier: 'glacier',
                }),
                createFileFixture({
                    id: 'f2',
                    batchId: batch.id,
                    storageTier: 'glacier',
                }),
            ];
            const newRetrievals = [
                createRetrievalFixture({
                    id: 'r1',
                    fileId: 'f1',
                    batchId: batch.id,
                }),
                createRetrievalFixture({
                    id: 'r2',
                    fileId: 'f2',
                    batchId: batch.id,
                }),
            ];

            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.files.findMany
                // First call: findByUserAndBatch
                .mockResolvedValueOnce(files)
                // Second call (if any): retrievalRepo.findByFileIds is on retrievals, not files
                .mockResolvedValue([]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue(newRetrievals);

            const result = await retrievalService.requestBatchRetrieval(
                db,
                TEST_USER_ID,
                batch.id,
                'standard'
            );

            expect(result).toHaveLength(2);
            expect(mocks.values).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ batchId: batch.id }),
                ])
            );
        });

        it('throws NotFoundError when batch missing or not owned', async () => {
            mocks.uploadBatches.findFirst.mockResolvedValue(undefined);

            await expect(
                retrievalService.requestBatchRetrieval(
                    db,
                    TEST_USER_ID,
                    TEST_BATCH_ID
                )
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when batch contains no files', async () => {
            const batch = createUploadBatchFixture();
            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.files.findMany.mockResolvedValue([]);

            await expect(
                retrievalService.requestBatchRetrieval(
                    db,
                    TEST_USER_ID,
                    batch.id
                )
            ).rejects.toThrow(InvalidStateError);
        });

        it('marks an all-standard batch ready immediately without calling RestoreObject', async () => {
            const restoreManySpy = vi.spyOn(mockS3.glacier, 'restoreMany');
            const batch = createUploadBatchFixture();
            const files = [
                createFileFixture({
                    id: 'f1',
                    batchId: batch.id,
                    storageTier: 'standard',
                }),
                createFileFixture({
                    id: 'f2',
                    batchId: batch.id,
                    storageTier: 'standard',
                }),
            ];
            const newRetrievals = [
                createRetrievalFixture({
                    id: 'r1',
                    fileId: 'f1',
                    batchId: batch.id,
                    status: 'ready',
                }),
                createRetrievalFixture({
                    id: 'r2',
                    fileId: 'f2',
                    batchId: batch.id,
                    status: 'ready',
                }),
            ];

            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue(newRetrievals);

            const result = await retrievalService.requestBatchRetrieval(
                db,
                TEST_USER_ID,
                batch.id
            );

            expect(result).toHaveLength(2);
            expect(restoreManySpy).not.toHaveBeenCalled();
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({ fileId: 'f1', status: 'ready' }),
                expect.objectContaining({ fileId: 'f2', status: 'ready' }),
            ]);
        });
    });

    describe('getBatchRetrievalStatus', () => {
        it('is not ready while any file in the batch is still restoring', async () => {
            const batch = createUploadBatchFixture();
            const files = [
                createFileFixture({ id: 'f1', batchId: batch.id }),
                createFileFixture({ id: 'f2', batchId: batch.id }),
            ];
            const retrievals = [
                createRetrievalFixture({
                    id: 'r1',
                    fileId: 'f1',
                    batchId: batch.id,
                    status: 'ready',
                }),
                createRetrievalFixture({
                    id: 'r2',
                    fileId: 'f2',
                    batchId: batch.id,
                    status: 'in_progress',
                }),
            ];

            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue(retrievals);

            const result = await retrievalService.getBatchRetrievalStatus(
                db,
                TEST_USER_ID,
                batch.id
            );

            expect(result).toEqual({
                totalFiles: 2,
                readyFiles: 1,
                isReady: false,
            });
        });

        it('is ready when every file in the batch has a ready retrieval', async () => {
            const batch = createUploadBatchFixture();
            const files = [
                createFileFixture({ id: 'f1', batchId: batch.id }),
                createFileFixture({ id: 'f2', batchId: batch.id }),
            ];
            // f1 was retrieved individually before the batch request — its
            // row has no batchId but must still count toward readiness.
            const retrievals = [
                createRetrievalFixture({
                    id: 'r1',
                    fileId: 'f1',
                    batchId: null,
                    status: 'ready',
                }),
                createRetrievalFixture({
                    id: 'r2',
                    fileId: 'f2',
                    batchId: batch.id,
                    status: 'ready',
                }),
            ];

            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue(retrievals);

            const result = await retrievalService.getBatchRetrievalStatus(
                db,
                TEST_USER_ID,
                batch.id
            );

            expect(result).toEqual({
                totalFiles: 2,
                readyFiles: 2,
                isReady: true,
            });
        });

        it('is not ready when no retrievals were requested', async () => {
            const batch = createUploadBatchFixture();
            const files = [createFileFixture({ id: 'f1', batchId: batch.id })];

            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            mocks.files.findMany.mockResolvedValue(files);
            mocks.retrievals.findMany.mockResolvedValue([]);

            const result = await retrievalService.getBatchRetrievalStatus(
                db,
                TEST_USER_ID,
                batch.id
            );

            expect(result).toEqual({
                totalFiles: 1,
                readyFiles: 0,
                isReady: false,
            });
        });

        it('throws NotFoundError when batch missing or not owned', async () => {
            mocks.uploadBatches.findFirst.mockResolvedValue(undefined);

            await expect(
                retrievalService.getBatchRetrievalStatus(
                    db,
                    TEST_USER_ID,
                    TEST_BATCH_ID
                )
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('getDownloadUrl', () => {
        it('returns presigned URL when retrieval is ready', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture({ status: 'ready' });

            mocks.files.findFirst.mockResolvedValue(file);
            mocks.retrievals.findFirst.mockResolvedValue(retrieval);

            const result = await retrievalService.getDownloadUrl(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toHaveProperty('url');
            expect(result).toHaveProperty('expiresAt');
            expect(result.url).toContain('https://mock-s3.test/test-bucket/');
            expect(result.expiresAt).toBeInstanceOf(Date);
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.files.findFirst.mockResolvedValue(undefined);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, 'nonexistent')
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when no retrieval exists', async () => {
            const file = createFileFixture();

            mocks.files.findFirst.mockResolvedValue(file);
            mocks.retrievals.findFirst.mockResolvedValue(undefined);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(InvalidStateError);
        });

        it('throws InvalidStateError when retrieval is not ready', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture({ status: 'pending' });

            mocks.files.findFirst.mockResolvedValue(file);
            mocks.retrievals.findFirst.mockResolvedValue(retrieval);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(InvalidStateError);
        });
    });
});

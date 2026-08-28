import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createFileFixture,
    createRetrievalFixture,
    createRetrievalRequestFixture,
    createUploadBatchFixture,
    TEST_BATCH_ID,
    TEST_RETRIEVAL_REQUEST_ID,
    TEST_USER_ID,
    TEST_FILE_ID,
} from '@nexus/db/testing';
import { retrievals as retrievalsTable } from '@nexus/db/schema';
import { mockS3 } from '@/lib/storage/testing';
import { NotFoundError, InvalidStateError } from '@/server/errors';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    const { createMockSentry } = await import('@/lib/sentry/testing');
    return { logger: createMockLogger(), sentry: createMockSentry() };
});

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));
vi.mock('@sentry/nextjs', () => hoisted.sentry);
vi.mock('@/lib/storage', () => ({
    s3: mockS3,
}));

import { retrievalService } from './retrieval';
import type { ObjectAvailability } from '@nexus/db/objectState';

describe('retrieval service', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        // Objects default to archived — the case that needs a RestoreObject,
        // and what the old `storageTier: 'glacier'` fixtures stood for. Tests
        // about warm or already-restored objects override this.
        setObjectState('archived');
    });

    /** Point the S3 mock at one availability for every key, or per-key. */
    function setObjectState(
        availability: ObjectAvailability,
        byKey: Record<string, ObjectAvailability> = {}
    ) {
        vi.spyOn(mockS3.glacier, 'getObjectState').mockImplementation(
            async (key: string) => ({
                availability: byKey[key] ?? availability,
            })
        );
    }

    describe('requestRetrieval', () => {
        it('creates retrieval for Glacier file', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture();

            // requestRetrieval delegates to requestBulkRetrieval:
            // findUserFiles -> findByFileIds -> insertMany -> s3.glacier.restore
            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([retrieval]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID,
                'standard'
            );

            expect(result).toEqual({
                requestId: expect.any(String),
                started: [retrieval],
                failed: [],
            });
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(1);
        });

        it('creates retrieval for deep_archive file', async () => {
            const file = createFileFixture();
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

            expect(result).toEqual({
                requestId: expect.any(String),
                started: [retrieval],
                failed: [],
            });
        });

        it('returns existing active retrieval (idempotent)', async () => {
            const file = createFileFixture();
            const existing = createRetrievalFixture({ status: 'pending' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([existing]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual({
                requestId: expect.any(String),
                started: [existing],
                failed: [],
            });
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(0);
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

        it('marks a warm file ready immediately without calling RestoreObject', async () => {
            setObjectState('warm');
            const restoreSpy = vi.spyOn(mockS3.glacier, 'restore');
            const file = createFileFixture();
            const retrieval = createRetrievalFixture({ status: 'ready' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([retrieval]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual({
                requestId: expect.any(String),
                started: [retrieval],
                failed: [],
            });
            expect(restoreSpy).not.toHaveBeenCalled();
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
            setObjectState('warm');
            const file = createFileFixture();
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
            setObjectState('warm');
            const file = createFileFixture();
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

            expect(result).toEqual({
                requestId: expect.any(String),
                started: [survivor],
                failed: [],
            });
            expect(mocks.retrievals.findMany).toHaveBeenCalledTimes(2);
        });
    });

    describe('requestBulkRetrieval', () => {
        it('creates retrievals for multiple files', async () => {
            const files = [
                createFileFixture({
                    id: 'file1',
                    s3Key: 'user/file1',
                }),
                createFileFixture({
                    id: 'file2',
                    s3Key: 'user/file2',
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

            expect(result.started).toHaveLength(2);
            expect(result.failed).toEqual([]);
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(1);
        });

        it('returns existing retrievals for files with active retrievals', async () => {
            const files = [
                createFileFixture({
                    id: 'file1',
                    s3Key: 'user/file1',
                }),
                createFileFixture({
                    id: 'file2',
                    s3Key: 'user/file2',
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

            expect(result.started).toHaveLength(2);
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

        it('restores only archived objects in a mixed request; warm ones are ready immediately', async () => {
            setObjectState('archived', { 'user/file2': 'warm' });
            const restoreSpy = vi.spyOn(mockS3.glacier, 'restore');
            const files = [
                createFileFixture({
                    id: 'file1',
                    s3Key: 'user/file1',
                }),
                createFileFixture({
                    id: 'file2',
                    s3Key: 'user/file2',
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

            expect(result.started).toHaveLength(2);
            expect(result.failed).toEqual([]);
            expect(restoreSpy).toHaveBeenCalledExactlyOnceWith(
                'user/file1',
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
            const files = [createFileFixture({ id: 'file1' })];
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

            expect(result).toEqual({
                requestId: expect.any(String),
                started: [existingRetrieval],
                failed: [],
            });
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(0);
        });
    });

    describe('S3 restore failure', () => {
        it('marks the row failed, reports it, and strips the raw error from the payload', async () => {
            const file = createFileFixture();
            const inserted = createRetrievalFixture();
            const failedRow = createRetrievalFixture({
                status: 'failed',
                failedAt: new Date(),
                errorMessage:
                    'User: arn:aws:iam::123456789012:user/nexus is not authorized',
            });

            vi.spyOn(mockS3.glacier, 'restore').mockRejectedValueOnce(
                new Error(failedRow.errorMessage!)
            );
            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            // First returning: insertMany; second: updateStatus('failed').
            mocks.returning
                .mockResolvedValueOnce([inserted])
                .mockResolvedValueOnce([failedRow]);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID,
                'bulk'
            );

            // The DB row keeps the raw AWS text; the mutation payload (no
            // output schema) must not carry ARNs/account ids to the client.
            expect(result).toEqual({
                requestId: expect.any(String),
                started: [],
                failed: [{ ...failedRow, errorMessage: null }],
            });
            // The old batch-wide throw reached logging middleware + Sentry;
            // the per-file catch must stay as loud.
            expect(hoisted.logger.error).toHaveBeenCalledOnce();
            expect(hoisted.sentry.captureException).toHaveBeenCalledOnce();
        });

        it('still resolves the batch when writing the failed status itself fails', async () => {
            const file = createFileFixture();
            const inserted = createRetrievalFixture();

            vi.spyOn(mockS3.glacier, 'restore').mockRejectedValueOnce(
                new Error('AWS throttled')
            );
            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning
                .mockResolvedValueOnce([inserted])
                .mockRejectedValueOnce(new Error('db connection lost'));

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID,
                'bulk'
            );

            // A rejected updateStatus must not reject the Promise.all and
            // discard sibling restores; the caller still hears `failed`.
            expect(result).toEqual({
                requestId: expect.any(String),
                started: [],
                failed: [{ ...inserted, errorMessage: null }],
            });
            expect(hoisted.sentry.captureException).toHaveBeenCalledTimes(2);
        });

        it('reports a conflict-skipped file as failed when the winning request already failed its restore', async () => {
            const restoreSpy = vi.spyOn(mockS3.glacier, 'restore');
            const file = createFileFixture();
            const winnersFailedRow = createRetrievalFixture({
                status: 'failed',
                failedAt: new Date(),
                errorMessage: 'AWS throttled',
            });

            mocks.files.findMany.mockResolvedValue([file]);
            // Pre-insert check sees nothing; the concurrent winner inserts,
            // fails its restore, and flips its row to `failed` before the
            // active-filtered survivors lookup runs — which then misses it.
            mocks.retrievals.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);
            mocks.returning.mockResolvedValue([]);
            mocks.retrievals.findFirst.mockResolvedValue(winnersFailedRow);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID,
                'bulk'
            );

            // Not `{started: [], failed: []}` — that would toast success for
            // a file with no restore in flight.
            expect(result).toEqual({
                requestId: expect.any(String),
                started: [],
                failed: [{ ...winnersFailedRow, errorMessage: null }],
            });
            expect(restoreSpy).not.toHaveBeenCalled();
        });
    });

    describe('requestBatchRetrieval', () => {
        /**
         * A two-file batch with no retrievals yet, wired through the mock DB.
         * `retrievalStatus` is what the inserted rows come back as — the only
         * thing the restore tests below differ on.
         */
        function arrangeBatchRestore(
            retrievalStatus: 'pending' | 'ready' = 'pending'
        ) {
            const batch = createUploadBatchFixture();
            const files = [
                createFileFixture({ id: 'f1', batchId: batch.id }),
                createFileFixture({ id: 'f2', batchId: batch.id }),
            ];
            const newRetrievals = [
                createRetrievalFixture({
                    id: 'r1',
                    fileId: 'f1',
                    status: retrievalStatus,
                }),
                createRetrievalFixture({
                    id: 'r2',
                    fileId: 'f2',
                    status: retrievalStatus,
                }),
            ];

            mocks.uploadBatches.findFirst.mockResolvedValue(batch);
            // First call is findByUserAndBatch; any later one is a different
            // lookup that must not see the batch again.
            mocks.files.findMany
                .mockResolvedValueOnce(files)
                .mockResolvedValue([]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue(newRetrievals);

            return { batch, files, newRetrievals };
        }

        it('records the upload batch on the request, not on the retrieval rows', async () => {
            const { batch } = arrangeBatchRestore();

            const result = await retrievalService.requestBatchRetrieval(
                db,
                TEST_USER_ID,
                batch.id,
                'standard'
            );

            expect(result.started).toHaveLength(2);
            // A whole upload batch is one way of selecting files, so it is
            // provenance on the request — the restore's identity is the
            // request itself (#422).
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: result.requestId,
                    uploadBatchId: batch.id,
                    tier: 'standard',
                })
            );
            expect(mocks.values).not.toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ batchId: batch.id }),
                ])
            );
        });

        it('records one request item per file, pointing at its retrieval', async () => {
            const { batch } = arrangeBatchRestore();

            const result = await retrievalService.requestBatchRetrieval(
                db,
                TEST_USER_ID,
                batch.id
            );

            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    requestId: result.requestId,
                    fileId: 'f1',
                    retrievalId: 'r1',
                }),
                expect.objectContaining({
                    requestId: result.requestId,
                    fileId: 'f2',
                    retrievalId: 'r2',
                }),
            ]);
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

        it('marks an all-warm batch ready immediately without calling RestoreObject', async () => {
            setObjectState('warm');
            const restoreSpy = vi.spyOn(mockS3.glacier, 'restore');
            const { batch } = arrangeBatchRestore('ready');

            const result = await retrievalService.requestBatchRetrieval(
                db,
                TEST_USER_ID,
                batch.id
            );

            expect(result.started).toHaveLength(2);
            expect(restoreSpy).not.toHaveBeenCalled();
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({ fileId: 'f1', status: 'ready' }),
                expect.objectContaining({ fileId: 'f2', status: 'ready' }),
            ]);
        });
    });

    // The counts themselves are produced by SQL over the request's items —
    // that half is exercised against a real database in
    // retrieval.integration.test.ts, including the adoption case a mocked
    // aggregate cannot show. What's left to pin down here is the
    // all-or-nothing rule and the ownership check.
    describe('getRequestStatus', () => {
        it('is not ready while any file in the request is still restoring', async () => {
            const request = createRetrievalRequestFixture();
            mocks.retrievalRequests.findFirst.mockResolvedValue(request);
            mocks.leftJoinRows.mockResolvedValue([
                { totalFiles: 2, readyFiles: 1 },
            ]);

            const result = await retrievalService.getRequestStatus(
                db,
                TEST_USER_ID,
                request.id
            );

            expect(result).toEqual({
                totalFiles: 2,
                readyFiles: 1,
                isReady: false,
            });
        });

        it('is ready when every file in the request is ready', async () => {
            const request = createRetrievalRequestFixture();
            mocks.retrievalRequests.findFirst.mockResolvedValue(request);
            mocks.leftJoinRows.mockResolvedValue([
                { totalFiles: 2, readyFiles: 2 },
            ]);

            const result = await retrievalService.getRequestStatus(
                db,
                TEST_USER_ID,
                request.id
            );

            expect(result).toEqual({
                totalFiles: 2,
                readyFiles: 2,
                isReady: true,
            });
        });

        it('is not ready when nothing in the request has thawed yet', async () => {
            const request = createRetrievalRequestFixture();
            mocks.retrievalRequests.findFirst.mockResolvedValue(request);
            mocks.leftJoinRows.mockResolvedValue([
                { totalFiles: 1, readyFiles: 0 },
            ]);

            const result = await retrievalService.getRequestStatus(
                db,
                TEST_USER_ID,
                request.id
            );

            expect(result).toEqual({
                totalFiles: 1,
                readyFiles: 0,
                isReady: false,
            });
        });

        it('throws NotFoundError when the request is missing or not owned', async () => {
            mocks.retrievalRequests.findFirst.mockResolvedValue(undefined);

            await expect(
                retrievalService.getRequestStatus(
                    db,
                    TEST_USER_ID,
                    TEST_RETRIEVAL_REQUEST_ID
                )
            ).rejects.toThrow(NotFoundError);
        });
    });

    describe('getDownloadUrl', () => {
        it('returns presigned URL when the object is readable', async () => {
            setObjectState('warm');
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

        it('serves an already-restored object', async () => {
            setObjectState('restored');
            const file = createFileFixture();

            mocks.files.findFirst.mockResolvedValue(file);

            const result = await retrievalService.getDownloadUrl(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result.url).toContain('https://mock-s3.test/test-bucket/');
        });

        // S3 owns object state (#416): a readable object downloads whether or
        // not a row says so, and the row can't authorize a cold one.
        it('serves a warm object with no retrieval row at all', async () => {
            setObjectState('warm');
            const file = createFileFixture();

            mocks.files.findFirst.mockResolvedValue(file);
            mocks.retrievals.findFirst.mockResolvedValue(undefined);

            const result = await retrievalService.getDownloadUrl(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result.url).toContain('https://mock-s3.test/test-bucket/');
        });

        // S3 owning warm/cold doesn't extend to lifecycle intent: a soft
        // delete leaves the object in the bucket (warm forever below the
        // lifecycle floor), and an unconfirmed upload's bytes may land before
        // confirmUpload runs. Neither may download, however readable S3 says
        // the object is.
        it('throws NotFoundError for a soft-deleted file even when warm', async () => {
            setObjectState('warm');
            const file = createFileFixture({ status: 'deleted' });

            mocks.files.findFirst.mockResolvedValue(file);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(NotFoundError);
        });

        it('throws NotFoundError for an unconfirmed upload even when warm', async () => {
            setObjectState('warm');
            const file = createFileFixture({ status: 'uploading' });

            mocks.files.findFirst.mockResolvedValue(file);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when the object is still archived', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture({ status: 'ready' });

            mocks.files.findFirst.mockResolvedValue(file);
            // A `ready` row does not make an archived object downloadable.
            mocks.retrievals.findFirst.mockResolvedValue(retrieval);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(InvalidStateError);
        });

        it('throws InvalidStateError while a restore is still in flight', async () => {
            setObjectState('restoring');
            const file = createFileFixture();

            mocks.files.findFirst.mockResolvedValue(file);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(InvalidStateError);
        });

        // A row pointing at an object that isn't in the bucket is a 404, not a
        // 500: only a DomainError survives errorHandlerMiddleware as anything
        // other than INTERNAL_SERVER_ERROR.
        it('throws NotFoundError when the object is gone from the bucket', async () => {
            const file = createFileFixture();
            mocks.files.findFirst.mockResolvedValue(file);
            vi.spyOn(mockS3.glacier, 'getObjectState').mockRejectedValue(
                Object.assign(new Error('NotFound'), {
                    name: 'NotFound',
                    $metadata: { httpStatusCode: 404 },
                })
            );

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(NotFoundError);
        });

        // Only a missing object maps: an outage or a lost IAM role must not be
        // reported to the user as "your file does not exist".
        it('rethrows a non-404 HeadObject failure untouched', async () => {
            const file = createFileFixture();
            mocks.files.findFirst.mockResolvedValue(file);
            vi.spyOn(mockS3.glacier, 'getObjectState').mockRejectedValue(
                Object.assign(new Error('AccessDenied'), {
                    name: 'AccessDenied',
                    $metadata: { httpStatusCode: 403 },
                })
            );

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow('AccessDenied');
        });
    });
});

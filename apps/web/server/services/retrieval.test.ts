import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createFileFixture,
    createRetrievalArtifactFixture,
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
import { mockJobs } from '@/lib/jobs/testing';
import { NotFoundError, InvalidStateError } from '@/server/errors';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return { logger: createMockLogger() };
});

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));
vi.mock('@/lib/storage', () => ({
    s3: mockS3,
}));
vi.mock('@/lib/jobs', () => ({ jobs: mockJobs }));

import { retrievalService } from './retrieval';
import type { ObjectAvailability } from '@nexus/db/objectState';

describe('retrieval service', () => {
    let db: MockDb;
    let mocks: MockDbMocks;
    let headSpy: ReturnType<typeof setObjectState>;
    let publishSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        // Objects default to archived — the case that needs a RestoreObject.
        // Only `getDownloadUrl` reads this now: the request path deliberately
        // asks S3 nothing (#423), which several tests below assert.
        headSpy = setObjectState('archived');
        publishSpy = vi.spyOn(mockJobs, 'publish');
    });

    /** Point the S3 mock at one availability for every key, or per-key. */
    function setObjectState(
        availability: ObjectAvailability,
        byKey: Record<string, ObjectAvailability> = {}
    ) {
        return vi
            .spyOn(mockS3.glacier, 'getObjectState')
            .mockImplementation(async (key: string) => ({
                availability: byKey[key] ?? availability,
            }));
    }

    describe('requestRetrieval', () => {
        it('writes a pending row and hands the S3 fan-out to a worker job', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture();

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
                fileCount: 1,
            });
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(1);
            // Rows before restore (#329), and `initiatedAt` still marks accept
            // time — the horizon the poll measures from wants a lower bound.
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    fileId: TEST_FILE_ID,
                    status: 'pending',
                    tier: 'standard',
                    initiatedAt: expect.any(Date),
                }),
            ]);
            expect(publishSpy).toHaveBeenCalledExactlyOnceWith(db, {
                type: 'initiate-restore',
                payload: { requestId: result.requestId },
            });
        });

        // The point of the move: an HTTP handler that HEADs 10,000 objects is
        // the shape #423 exists to remove.
        it('asks S3 nothing on the request path', async () => {
            const file = createFileFixture();

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([createRetrievalFixture()]);

            await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(headSpy).not.toHaveBeenCalled();
        });

        it('defaults to the bulk tier', async () => {
            const file = createFileFixture();

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([createRetrievalFixture()]);

            await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            // The retrieval rows — insertMany passes an array.
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({ tier: 'bulk' }),
            ]);
            // ...and the request row itself, which insert passes bare. Both
            // carry the tier: the request is what the zip pipeline and the poll
            // read it from, the rows are what the RestoreObject uses.
            expect(mocks.values).toHaveBeenCalledWith(
                expect.objectContaining({ tier: 'bulk' })
            );
        });

        it('adopts an active retrieval instead of publishing a second job', async () => {
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
                fileCount: 1,
            });
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(0);
            // Nothing to initiate: the restore already in flight is what makes
            // this request ready, and its own job is already doing the asking.
            expect(publishSpy).not.toHaveBeenCalled();
            // The item still points at the adopted row, or readiness could
            // never count this request.
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    fileId: TEST_FILE_ID,
                    retrievalId: existing.id,
                }),
            ]);
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

        it('adopts the surviving row when a concurrent request wins the insert race', async () => {
            const file = createFileFixture();
            const survivor = createRetrievalFixture({ status: 'pending' });

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
                fileCount: 1,
            });
            expect(mocks.retrievals.findMany).toHaveBeenCalledTimes(2);
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({ retrievalId: survivor.id }),
            ]);
        });

        it('adopts the winner row even when its restore already failed', async () => {
            const file = createFileFixture();
            const winnersFailedRow = createRetrievalFixture({
                status: 'failed',
                failedAt: new Date(),
                errorMessage: 'AWS throttled',
            });

            mocks.files.findMany.mockResolvedValue([file]);
            // The winner inserted, its job failed the restore, and its row flipped
            // to `failed` before the active-filtered lookup ran — which misses it.
            mocks.retrievals.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);
            mocks.returning.mockResolvedValue([]);
            mocks.retrievals.findFirst.mockResolvedValue(winnersFailedRow);

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            // The item points at the failed row rather than at nothing: a file
            // with no live restore behind it must read as not-ready, not as a
            // file nobody asked for.
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    requestId: result.requestId,
                    retrievalId: winnersFailedRow.id,
                }),
            ]);
        });
    });

    describe('requestBulkRetrieval', () => {
        it('writes every file in one insert and publishes one job', async () => {
            const files = [
                createFileFixture({ id: 'file1', s3Key: 'user/file1' }),
                createFileFixture({ id: 'file2', s3Key: 'user/file2' }),
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

            expect(result.fileCount).toBe(2);
            // One statement, not one per file: what makes the raised cap
            // survivable is that the request path's cost is flat in file count.
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(1);
            expect(publishSpy).toHaveBeenCalledOnce();
        });

        it('counts adopted files in fileCount and still publishes for the rest', async () => {
            const files = [
                createFileFixture({ id: 'file1', s3Key: 'user/file1' }),
                createFileFixture({ id: 'file2', s3Key: 'user/file2' }),
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

            // The user asked for two files; one of them was already covered.
            expect(result.fileCount).toBe(2);
            expect(mocks.values).toHaveBeenCalledWith([
                expect.objectContaining({
                    fileId: 'file1',
                    retrievalId: 'r1',
                }),
                expect.objectContaining({
                    fileId: 'file2',
                    retrievalId: 'r2',
                }),
            ]);
            expect(publishSpy).toHaveBeenCalledOnce();
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

        it('throws InvalidStateError when any file is not available', async () => {
            const files = [
                createFileFixture({ id: 'file1' }),
                createFileFixture({ id: 'file2', status: 'deleted' }),
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

        it('publishes nothing when every file already has an active retrieval', async () => {
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
                fileCount: 1,
            });
            expect(mocks.countInsertsInto(retrievalsTable)).toBe(0);
            expect(publishSpy).not.toHaveBeenCalled();
        });

        // A restore nobody was told to start would sit `pending` until the 48h
        // stuck-retrieval check notices, with the user told it succeeded.
        it('fails the request when the job cannot be published', async () => {
            const file = createFileFixture({ id: 'file1' });

            mocks.files.findMany.mockResolvedValue([file]);
            mocks.retrievals.findMany.mockResolvedValue([]);
            mocks.returning.mockResolvedValue([createRetrievalFixture()]);
            publishSpy.mockRejectedValueOnce(new Error('SQS unavailable'));

            await expect(
                retrievalService.requestBulkRetrieval(db, TEST_USER_ID, [
                    'file1',
                ])
            ).rejects.toThrow('SQS unavailable');
        });
    });

    describe('requestBatchRetrieval', () => {
        /** A two-file batch with no retrievals yet, wired through the mock DB. */
        function arrangeBatchRestore() {
            const batch = createUploadBatchFixture();
            const files = [
                createFileFixture({ id: 'f1', batchId: batch.id }),
                createFileFixture({ id: 'f2', batchId: batch.id }),
            ];
            const newRetrievals = [
                createRetrievalFixture({ id: 'r1', fileId: 'f1' }),
                createRetrievalFixture({ id: 'r2', fileId: 'f2' }),
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

            expect(result.fileCount).toBe(2);
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

    // The zip-delivery surface (#426). Everything here is driven by artifacts,
    // never by the retrieval rows behind them: those carry a two-day window
    // while the zips they fed stay downloadable for seven.
    describe('zip delivery', () => {
        const BUILT_AT = new Date('2026-08-30T10:00:00Z');
        const EXPECTED_EXPIRY = new Date('2026-09-06T10:00:00Z');

        /** One row as findDownloadableByUser's aggregate returns it. */
        function downloadableRow(overrides = {}) {
            return {
                id: TEST_RETRIEVAL_REQUEST_ID,
                tier: 'bulk',
                completedAt: new Date('2026-08-30T10:05:00Z'),
                fileCount: 12,
                partCount: 2,
                // bigint comes back from postgres as a string.
                totalBytes: '4000',
                builtAt: BUILT_AT,
                ...overrides,
            };
        }

        describe('listReadyRequests', () => {
            it("quotes the artifact's window, not the retrievals'", async () => {
                mocks.groupByRows.mockResolvedValue([downloadableRow()]);

                const [request] = await retrievalService.listReadyRequests(
                    db,
                    TEST_USER_ID
                );

                expect(request).toMatchObject({
                    requestId: TEST_RETRIEVAL_REQUEST_ID,
                    fileCount: 12,
                    partCount: 2,
                    totalBytes: 4000,
                });
                expect(request.expiresAt).toEqual(EXPECTED_EXPIRY);
            });
        });

        describe('getRequestDelivery', () => {
            it('lists the ready parts, 1-based, with per-part expiry', async () => {
                mocks.retrievalRequests.findFirst.mockResolvedValue(
                    createRetrievalRequestFixture({ completedAt: new Date() })
                );
                mocks.groupByRows.mockResolvedValue([downloadableRow()]);
                mocks.retrievalArtifacts.findMany.mockResolvedValue([
                    createRetrievalArtifactFixture({
                        id: 'artifact-a',
                        position: 0,
                        status: 'ready',
                        s3Key: `${TEST_USER_ID}/req/artifact-a/nexus-part-1.zip`,
                        sizeBytes: 3000,
                        completedAt: BUILT_AT,
                    }),
                    // Still building: it must not offer a download link.
                    createRetrievalArtifactFixture({
                        id: 'artifact-b',
                        position: 1,
                        status: 'building',
                    }),
                ]);

                const delivery = await retrievalService.getRequestDelivery(
                    db,
                    TEST_USER_ID,
                    TEST_RETRIEVAL_REQUEST_ID
                );

                expect(delivery.state).toBe('ready');
                if (delivery.state !== 'ready') return;
                expect(delivery.artifacts).toHaveLength(1);
                expect(delivery.artifacts[0]).toEqual({
                    artifactId: 'artifact-a',
                    part: 1,
                    sizeBytes: 3000,
                    fileName: 'nexus-part-1.zip',
                    expiresAt: EXPECTED_EXPIRY,
                });
            });

            // The key always says "part-1"; only a chunked restore should.
            it('names a single-archive restore without a part number', async () => {
                mocks.retrievalRequests.findFirst.mockResolvedValue(
                    createRetrievalRequestFixture({ completedAt: new Date() })
                );
                mocks.groupByRows.mockResolvedValue([
                    downloadableRow({ partCount: 1 }),
                ]);
                mocks.retrievalArtifacts.findMany.mockResolvedValue([
                    createRetrievalArtifactFixture({
                        id: 'artifact-a',
                        position: 0,
                        status: 'ready',
                        s3Key: `${TEST_USER_ID}/req/artifact-a/nexus-part-1.zip`,
                        sizeBytes: 3000,
                        completedAt: BUILT_AT,
                    }),
                ]);

                const delivery = await retrievalService.getRequestDelivery(
                    db,
                    TEST_USER_ID,
                    TEST_RETRIEVAL_REQUEST_ID
                );

                expect(delivery.state).toBe('ready');
                if (delivery.state !== 'ready') return;
                expect(delivery.artifacts[0].fileName).toBe(
                    'nexus-restore.zip'
                );
            });

            // The two non-ready states mean opposite things to the reader, and
            // the panel polls on exactly that difference.
            it('reads a request with no completedAt as still building', async () => {
                mocks.retrievalRequests.findFirst.mockResolvedValue(
                    createRetrievalRequestFixture({ completedAt: null })
                );
                mocks.groupByRows.mockResolvedValue([]);

                await expect(
                    retrievalService.getRequestDelivery(
                        db,
                        TEST_USER_ID,
                        TEST_RETRIEVAL_REQUEST_ID
                    )
                ).resolves.toEqual({ state: 'building' });
            });

            it('reads a completed request with no live artifacts as expired', async () => {
                mocks.retrievalRequests.findFirst.mockResolvedValue(
                    createRetrievalRequestFixture({ completedAt: new Date() })
                );
                mocks.groupByRows.mockResolvedValue([]);

                await expect(
                    retrievalService.getRequestDelivery(
                        db,
                        TEST_USER_ID,
                        TEST_RETRIEVAL_REQUEST_ID
                    )
                ).resolves.toEqual({ state: 'expired' });
            });

            it("404s another user's request", async () => {
                mocks.retrievalRequests.findFirst.mockResolvedValue(undefined);

                await expect(
                    retrievalService.getRequestDelivery(
                        db,
                        TEST_USER_ID,
                        TEST_RETRIEVAL_REQUEST_ID
                    )
                ).rejects.toThrow(NotFoundError);
            });
        });

        describe('getArtifactDownloadUrl', () => {
            /** The user-scoped artifact lookup ends at .limit(). */
            function givenArtifact(artifact: unknown) {
                mocks.limit.mockResolvedValue(artifact ? [{ artifact }] : []);
            }

            it('presigns against the artifacts bucket, named for the part', async () => {
                givenArtifact(
                    createRetrievalArtifactFixture({
                        status: 'ready',
                        s3Key: `${TEST_USER_ID}/req/art/nexus-part-2.zip`,
                        completedAt: new Date(),
                    })
                );
                mocks.retrievalArtifacts.findMany.mockResolvedValue([
                    createRetrievalArtifactFixture({ position: 0 }),
                    createRetrievalArtifactFixture({ position: 1 }),
                ]);

                const get = vi.spyOn(mockS3.artifacts, 'get');

                const result = await retrievalService.getArtifactDownloadUrl(
                    db,
                    TEST_USER_ID,
                    'artifact-a'
                );

                expect(result.url).toContain('artifacts-test-bucket');
                expect(get).toHaveBeenCalledWith(
                    expect.stringContaining('nexus-part-2.zip'),
                    expect.objectContaining({ filename: 'nexus-part-2.zip' })
                );
            });

            it('names a single-archive download without a part number', async () => {
                givenArtifact(
                    createRetrievalArtifactFixture({
                        status: 'ready',
                        s3Key: `${TEST_USER_ID}/req/art/nexus-part-1.zip`,
                        completedAt: new Date(),
                    })
                );
                mocks.retrievalArtifacts.findMany.mockResolvedValue([
                    createRetrievalArtifactFixture({ position: 0 }),
                ]);

                const get = vi.spyOn(mockS3.artifacts, 'get');

                await retrievalService.getArtifactDownloadUrl(
                    db,
                    TEST_USER_ID,
                    'artifact-a'
                );

                expect(get).toHaveBeenCalledWith(
                    expect.stringContaining('nexus-part-1.zip'),
                    expect.objectContaining({ filename: 'nexus-restore.zip' })
                );
            });

            it('refuses a part that is still building', async () => {
                givenArtifact(
                    createRetrievalArtifactFixture({ status: 'building' })
                );

                await expect(
                    retrievalService.getArtifactDownloadUrl(
                        db,
                        TEST_USER_ID,
                        'artifact-a'
                    )
                ).rejects.toThrow(InvalidStateError);
            });

            // S3's lifecycle rule has already taken the bytes; a presigned URL
            // would 404 in the browser with no explanation.
            it('refuses a part past its retention window', async () => {
                givenArtifact(
                    createRetrievalArtifactFixture({
                        status: 'ready',
                        s3Key: 'user/req/art/nexus-part-1.zip',
                        completedAt: new Date('2020-01-01T00:00:00Z'),
                    })
                );

                await expect(
                    retrievalService.getArtifactDownloadUrl(
                        db,
                        TEST_USER_ID,
                        'artifact-a'
                    )
                ).rejects.toThrow(/expired/);
            });

            it("404s another user's artifact", async () => {
                givenArtifact(null);

                await expect(
                    retrievalService.getArtifactDownloadUrl(
                        db,
                        TEST_USER_ID,
                        'artifact-a'
                    )
                ).rejects.toThrow(NotFoundError);
            });
        });
    });
});

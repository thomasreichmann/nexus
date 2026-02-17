import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    createFileFixture,
    createRetrievalFixture,
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
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

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
            mocks.findMany
                .mockResolvedValueOnce([file]) // findUserFiles
                .mockResolvedValueOnce([]); // findByFileIds (no existing)
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

            mocks.findMany
                .mockResolvedValueOnce([file])
                .mockResolvedValueOnce([]);
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

            mocks.findMany
                .mockResolvedValueOnce([file]) // findUserFiles
                .mockResolvedValueOnce([existing]); // findByFileIds returns active retrieval

            const result = await retrievalService.requestRetrieval(
                db,
                TEST_USER_ID,
                TEST_FILE_ID
            );

            expect(result).toEqual(existing);
            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('throws NotFoundError when file does not exist', async () => {
            mocks.findMany.mockResolvedValueOnce([]); // findUserFiles returns empty

            await expect(
                retrievalService.requestRetrieval(
                    db,
                    TEST_USER_ID,
                    'nonexistent'
                )
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when file is not in Glacier tier', async () => {
            const file = createFileFixture({ storageTier: 'standard' });

            mocks.findMany
                .mockResolvedValueOnce([file]) // findUserFiles
                .mockResolvedValueOnce([]); // findByFileIds (no existing)

            await expect(
                retrievalService.requestRetrieval(
                    db,
                    TEST_USER_ID,
                    TEST_FILE_ID
                )
            ).rejects.toThrow(InvalidStateError);
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

            mocks.findMany
                .mockResolvedValueOnce(files) // findUserFiles
                .mockResolvedValueOnce([]); // findByFileIds (no existing)
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

            mocks.findMany
                .mockResolvedValueOnce(files) // findUserFiles
                .mockResolvedValueOnce([existingRetrieval]); // findByFileIds
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
            mocks.findMany.mockResolvedValueOnce(files);

            await expect(
                retrievalService.requestBulkRetrieval(db, TEST_USER_ID, [
                    'file1',
                    'file2',
                ])
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when any file is not in Glacier tier', async () => {
            const files = [
                createFileFixture({
                    id: 'file1',
                    storageTier: 'glacier',
                }),
                createFileFixture({
                    id: 'file2',
                    storageTier: 'standard',
                }),
            ];

            mocks.findMany
                .mockResolvedValueOnce(files) // findUserFiles
                .mockResolvedValueOnce([]); // findByFileIds (no existing)

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

            mocks.findMany
                .mockResolvedValueOnce(files) // findUserFiles
                .mockResolvedValueOnce([existingRetrieval]); // findByFileIds

            const result = await retrievalService.requestBulkRetrieval(
                db,
                TEST_USER_ID,
                ['file1']
            );

            expect(result).toEqual([existingRetrieval]);
            expect(mocks.insert).not.toHaveBeenCalled();
        });
    });

    describe('getDownloadUrl', () => {
        it('returns presigned URL when retrieval is ready', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture({ status: 'ready' });

            mocks.findFirst
                .mockResolvedValueOnce(file) // findUserFile
                .mockResolvedValueOnce(retrieval); // findByFileId

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
            mocks.findFirst.mockResolvedValue(undefined);

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, 'nonexistent')
            ).rejects.toThrow(NotFoundError);
        });

        it('throws InvalidStateError when no retrieval exists', async () => {
            const file = createFileFixture();

            mocks.findFirst
                .mockResolvedValueOnce(file) // findUserFile
                .mockResolvedValueOnce(undefined); // findByFileId (no retrieval)

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(InvalidStateError);
        });

        it('throws InvalidStateError when retrieval is not ready', async () => {
            const file = createFileFixture();
            const retrieval = createRetrievalFixture({ status: 'pending' });

            mocks.findFirst
                .mockResolvedValueOnce(file) // findUserFile
                .mockResolvedValueOnce(retrieval); // findByFileId

            await expect(
                retrievalService.getDownloadUrl(db, TEST_USER_ID, TEST_FILE_ID)
            ).rejects.toThrow(InvalidStateError);
        });
    });
});

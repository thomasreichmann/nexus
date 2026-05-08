import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDb, type MockDbMocks } from './mocks';
import {
    createUploadBatchFixture,
    TEST_BATCH_ID,
    TEST_USER_ID,
} from './fixtures';
import { createUploadBatchRepo, type UploadBatchRepo } from './uploadBatches';

describe('uploadBatches repository', () => {
    let mocks: MockDbMocks;
    let repo: UploadBatchRepo;

    beforeEach(() => {
        const mockDb = createMockDb();
        mocks = mockDb.mocks;
        repo = createUploadBatchRepo(mockDb.db);
    });

    describe('findByUserAndId', () => {
        it('returns batch when user owns it', async () => {
            const batch = createUploadBatchFixture();
            mocks.uploadBatches.findFirst.mockResolvedValue(batch);

            const result = await repo.findByUserAndId(
                TEST_USER_ID,
                TEST_BATCH_ID
            );

            expect(result).toEqual(batch);
        });

        it('returns undefined when user does not own batch', async () => {
            mocks.uploadBatches.findFirst.mockResolvedValue(undefined);

            const result = await repo.findByUserAndId(
                'other_user',
                TEST_BATCH_ID
            );

            expect(result).toBeUndefined();
        });
    });
});

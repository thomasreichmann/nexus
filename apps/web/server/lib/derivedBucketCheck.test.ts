import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return { logger: createMockLogger(), alertsSend: vi.fn() };
});

vi.mock('@/lib/alerts', () => ({ alerts: { send: hoisted.alertsSend } }));
vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));
vi.mock('@/lib/env', () => ({ env: { S3_DERIVED_BUCKET: 'derived-bucket' } }));
vi.mock('@/server/db', () => ({ db: {} }));

import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    TEST_FILE_ID,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { mockS3 } from '@/lib/storage/testing';
import { checkDerivedBucket } from './derivedBucketCheck';

vi.mock('@/lib/storage', () => ({ s3: mockS3 }));

describe('checkDerivedBucket', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        ({ db, mocks } = createMockDb());
        mocks.files.findFirst.mockResolvedValue({
            id: TEST_FILE_ID,
            userId: TEST_USER_ID,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('stays quiet when a ready thumbnail reads back', async () => {
        const probe = vi.spyOn(mockS3.derived, 'probe');

        await checkDerivedBucket(db);

        expect(probe).toHaveBeenCalledWith(
            `${TEST_USER_ID}/${TEST_FILE_ID}/thumb.webp`
        );
        expect(hoisted.alertsSend).not.toHaveBeenCalled();
        expect(hoisted.logger.error).not.toHaveBeenCalled();
    });

    it('alerts when the bucket is configured but unreadable', async () => {
        const denied = Object.assign(new Error('Forbidden'), {
            name: '403',
        });
        vi.spyOn(mockS3.derived, 'probe').mockRejectedValue(denied);

        await checkDerivedBucket(db);

        expect(hoisted.logger.error).toHaveBeenCalledOnce();
        expect(hoisted.alertsSend).toHaveBeenCalledWith(
            expect.objectContaining({
                severity: 'error',
                context: expect.objectContaining({
                    source: 'boot',
                    bucket: 'derived-bucket',
                    error: '403: Forbidden',
                }),
            })
        );
    });

    it('skips when no file has a ready thumbnail to read', async () => {
        mocks.files.findFirst.mockResolvedValue(undefined);
        const probe = vi.spyOn(mockS3.derived, 'probe');

        await checkDerivedBucket(db);

        expect(probe).not.toHaveBeenCalled();
        expect(hoisted.alertsSend).not.toHaveBeenCalled();
    });

    it('only warns when the bucket is unset', async () => {
        vi.spyOn(mockS3.derived, 'isConfigured').mockReturnValue(false);

        await checkDerivedBucket(db);

        expect(hoisted.logger.warn).toHaveBeenCalledOnce();
        expect(mocks.files.findFirst).not.toHaveBeenCalled();
        expect(hoisted.alertsSend).not.toHaveBeenCalled();
    });
});

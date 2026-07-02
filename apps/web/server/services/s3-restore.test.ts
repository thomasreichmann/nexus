import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    createFileFixture,
    createRetrievalFixture,
    TEST_FILE_ID,
    TEST_RETRIEVAL_ID,
    TEST_USER_ID,
} from '@nexus/db/testing';
import type { S3EventRecord } from '@/lib/sns/types';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return {
        logger: createMockLogger(),
        sendRetrievalReadyEmail: vi.fn(),
    };
});

vi.mock('@/lib/env', () => ({
    env: { NEXT_PUBLIC_APP_URL: 'https://test.example' },
}));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

vi.mock('@/server/services/email', () => ({
    emailService: { sendRetrievalReadyEmail: hoisted.sendRetrievalReadyEmail },
}));

import { s3RestoreService } from './s3-restore';

const RESTORE_EXPIRY = '2026-07-10T12:00:00.000Z';

function makeRecord(overrides: Partial<S3EventRecord> = {}): S3EventRecord {
    return {
        eventName: 's3:ObjectRestore:Completed',
        s3: {
            bucket: { name: 'test-bucket' },
            object: { key: 'uploads/test-file.jpg' },
        },
        glacierEventData: {
            restoreEventData: {
                lifecycleRestorationExpiryTime: RESTORE_EXPIRY,
            },
        },
        ...overrides,
    };
}

describe('s3RestoreService.dispatch', () => {
    let mockDb: ReturnType<typeof createMockDb>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDb = createMockDb();
        mockDb.mocks.files.findFirst.mockResolvedValue(createFileFixture());
        mockDb.mocks.retrievals.findFirst.mockResolvedValue(
            createRetrievalFixture()
        );
    });

    describe('restore completed', () => {
        it('sends the retrieval-ready email to the file owner with an app deep-link', async () => {
            const handled = await s3RestoreService.dispatch(
                mockDb.db,
                makeRecord()
            );

            expect(handled).toBe(true);
            expect(hoisted.sendRetrievalReadyEmail).toHaveBeenCalledTimes(1);
            expect(hoisted.sendRetrievalReadyEmail).toHaveBeenCalledWith(
                mockDb.db,
                {
                    userId: TEST_USER_ID,
                    fileName: createFileFixture().name,
                    downloadUrl: `https://test.example/dashboard/files?file=${TEST_FILE_ID}`,
                    expiresAt: new Date(RESTORE_EXPIRY),
                }
            );
        });

        it('does not throw when the email send fails', async () => {
            hoisted.sendRetrievalReadyEmail.mockRejectedValueOnce(
                new Error('resend down')
            );

            await expect(
                s3RestoreService.dispatch(mockDb.db, makeRecord())
            ).resolves.toBe(true);

            expect(hoisted.logger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileId: TEST_FILE_ID,
                    retrievalId: TEST_RETRIEVAL_ID,
                }),
                'Retrieval-ready notification failed after restore completion'
            );
        });

        it('skips the email when the event carries no expiry', async () => {
            await s3RestoreService.dispatch(
                mockDb.db,
                makeRecord({ glacierEventData: undefined })
            );

            expect(hoisted.sendRetrievalReadyEmail).not.toHaveBeenCalled();
            expect(hoisted.logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ fileId: TEST_FILE_ID }),
                'Skipping retrieval-ready email: no expiry available'
            );
        });

        it('sends no email when the file is unknown', async () => {
            mockDb.mocks.files.findFirst.mockResolvedValue(undefined);

            const handled = await s3RestoreService.dispatch(
                mockDb.db,
                makeRecord()
            );

            expect(handled).toBe(true);
            expect(hoisted.sendRetrievalReadyEmail).not.toHaveBeenCalled();
        });
    });

    describe('non-completion events', () => {
        it('sends no email on restore expiry', async () => {
            const handled = await s3RestoreService.dispatch(
                mockDb.db,
                makeRecord({ eventName: 's3:ObjectRestore:Delete' })
            );

            expect(handled).toBe(true);
            expect(hoisted.sendRetrievalReadyEmail).not.toHaveBeenCalled();
        });

        it('sends no email for unhandled event types', async () => {
            const handled = await s3RestoreService.dispatch(
                mockDb.db,
                makeRecord({ eventName: 's3:ObjectCreated:Put' })
            );

            expect(handled).toBe(false);
            expect(hoisted.sendRetrievalReadyEmail).not.toHaveBeenCalled();
        });
    });
});

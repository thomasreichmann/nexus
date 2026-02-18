import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SQSRecord } from 'aws-lambda';
import { createMockDb, TEST_JOB_ID, TEST_USER_ID } from '@nexus/db/testing';

// Mock @nexus/db module to prevent real DB connection
vi.mock('@nexus/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@nexus/db')>();
    const { createMockDb } = await import('@nexus/db/testing');
    return {
        ...actual,
        createDb: vi.fn(() => createMockDb().db),
    };
});

// Mock handlers/index to prevent side-effect import
vi.mock('./handlers/index', () => ({}));

import { processRecord } from './handler';
import { registerHandler } from './registry';

function createSqsRecord(body: object): SQSRecord {
    return {
        messageId: 'msg-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify(body),
        attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'sender',
            ApproximateFirstReceiveTimestamp: '1234567890',
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test',
        awsRegion: 'us-east-1',
    };
}

describe('processRecord', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;

        // Register a successful handler
        registerHandler('delete-account', async () => {});
    });

    it('marks job as processing then completed on success', async () => {
        const record = createSqsRecord({
            jobId: TEST_JOB_ID,
            type: 'delete-account',
            payload: { userId: TEST_USER_ID },
        });

        mocks.returning.mockResolvedValue([{ id: TEST_JOB_ID }]);

        await processRecord(db, record);

        // markJobProcessing: update → set (status: processing) → where
        // updateJob: update → set (status: completed) → where → returning
        expect(mocks.update).toHaveBeenCalledTimes(2);
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'processing' })
        );
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'completed' })
        );
    });

    it('marks job as failed and re-throws on handler error', async () => {
        registerHandler('delete-account', async () => {
            throw new Error('handler failed');
        });

        const record = createSqsRecord({
            jobId: TEST_JOB_ID,
            type: 'delete-account',
            payload: { userId: TEST_USER_ID },
        });

        mocks.returning.mockResolvedValue([{ id: TEST_JOB_ID }]);

        await expect(processRecord(db, record)).rejects.toThrow(
            'handler failed'
        );

        // Should have called updateJob with failed status and error message
        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'failed',
                error: 'handler failed',
            })
        );
    });
});

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createMockDb, createJobFixture, TEST_USER_ID } from '@nexus/db';
import { publish } from './publish';

vi.mock('./client', () => ({
    client: { send: vi.fn() },
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue',
}));

describe('publish', () => {
    let db: ReturnType<typeof createMockDb>['db'];
    let mocks: ReturnType<typeof createMockDb>['mocks'];
    let sqsClient: { send: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;

        const clientModule = await import('./client');
        sqsClient = clientModule.client as unknown as typeof sqsClient;
    });

    it('inserts a DB record and sends an SQS message', async () => {
        const jobFixture = createJobFixture();
        mocks.returning.mockResolvedValue([jobFixture]);
        sqsClient.send.mockResolvedValue({});

        const result = await publish(db, {
            type: 'delete-account',
            payload: { userId: TEST_USER_ID },
        });

        expect(result).toEqual(jobFixture);

        // Verify DB insert was called
        expect(mocks.insert).toHaveBeenCalledOnce();
        expect(mocks.values).toHaveBeenCalledWith({
            type: 'delete-account',
            payload: { userId: TEST_USER_ID },
        });

        // Verify SQS message was sent
        expect(sqsClient.send).toHaveBeenCalledOnce();
        const command = sqsClient.send.mock.calls[0][0];
        const body = JSON.parse(command.input.MessageBody);
        expect(body).toEqual({
            jobId: jobFixture.id,
            type: 'delete-account',
            payload: { userId: TEST_USER_ID },
        });
    });

    it('returns the inserted job record', async () => {
        const jobFixture = createJobFixture({ type: 'delete-account' });
        mocks.returning.mockResolvedValue([jobFixture]);
        sqsClient.send.mockResolvedValue({});

        const result = await publish(db, {
            type: 'delete-account',
            payload: { userId: TEST_USER_ID },
        });

        expect(result.id).toBe(jobFixture.id);
        expect(result.type).toBe('delete-account');
        expect(result.status).toBe('pending');
    });

    it('throws when SQS send fails (DB record still exists)', async () => {
        const jobFixture = createJobFixture();
        mocks.returning.mockResolvedValue([jobFixture]);
        sqsClient.send.mockRejectedValue(new Error('SQS unavailable'));

        await expect(
            publish(db, {
                type: 'delete-account',
                payload: { userId: TEST_USER_ID },
            })
        ).rejects.toThrow('SQS unavailable');

        // DB insert should have been called before the SQS failure
        expect(mocks.insert).toHaveBeenCalledOnce();
    });

    it('does not send SQS message if DB insert fails', async () => {
        mocks.returning.mockRejectedValue(new Error('DB connection error'));

        await expect(
            publish(db, {
                type: 'delete-account',
                payload: { userId: TEST_USER_ID },
            })
        ).rejects.toThrow('DB connection error');

        // SQS should never be called
        expect(sqsClient.send).not.toHaveBeenCalled();
    });
});

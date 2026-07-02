import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createUserFixture,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { mockEmail } from '@/lib/email/testing';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return { logger: createMockLogger() };
});

vi.mock('@/lib/email', () => ({
    email: mockEmail,
}));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

const { emailService } = await import('./email');

describe('email service', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    const opts = {
        userId: TEST_USER_ID,
        fileName: 'vacation-photos.zip',
        downloadUrl: 'https://mock-s3.test/test-bucket/user123/file456',
        expiresAt: new Date('2026-07-08T15:45:00Z'),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    describe('sendRetrievalReadyEmail', () => {
        it("sends to the user's email with a subject naming the file", async () => {
            const user = createUserFixture({
                id: TEST_USER_ID,
                email: 'user@example.com',
            });
            mocks.user.findFirst.mockResolvedValue(user);

            await emailService.sendRetrievalReadyEmail(db, opts);

            expect(mockEmail.send).toHaveBeenCalledOnce();
            const sent = mockEmail.send.mock.calls[0][0];
            expect(sent.to).toBe('user@example.com');
            expect(sent.subject).toContain('vacation-photos.zip');
            expect(sent.react).toBeDefined();
        });

        it('logs and skips when the user does not exist', async () => {
            mocks.user.findFirst.mockResolvedValue(undefined);

            await expect(
                emailService.sendRetrievalReadyEmail(db, opts)
            ).resolves.toBeUndefined();
            expect(mockEmail.send).not.toHaveBeenCalled();
            expect(hoisted.logger.warn).toHaveBeenCalledWith(
                { userId: TEST_USER_ID },
                'Skipping retrieval-ready email for unknown user'
            );
        });

        it('logs and swallows when the send fails', async () => {
            const user = createUserFixture({
                id: TEST_USER_ID,
                email: 'user@example.com',
            });
            mocks.user.findFirst.mockResolvedValue(user);
            mockEmail.send.mockRejectedValueOnce(new Error('Resend outage'));

            await expect(
                emailService.sendRetrievalReadyEmail(db, opts)
            ).resolves.toBeUndefined();
            expect(hoisted.logger.warn).toHaveBeenCalledWith(
                { userId: TEST_USER_ID, err: expect.any(Error) },
                'Failed to send retrieval-ready email'
            );
        });
    });

    describe('sendInviteEmail', () => {
        const inviteOpts = {
            to: 'tester@example.com',
            inviteUrl: 'https://test.example/invite/abc123token',
            expiresAt: null,
        };

        it('sends to the bound email with the free-access subject', async () => {
            await emailService.sendInviteEmail(inviteOpts);

            expect(mockEmail.send).toHaveBeenCalledOnce();
            const sent = mockEmail.send.mock.calls[0][0];
            expect(sent.to).toBe('tester@example.com');
            expect(sent.subject).toContain('free access to Nexus');
            expect(sent.react).toBeDefined();
        });

        it('logs and swallows when the send fails', async () => {
            mockEmail.send.mockRejectedValueOnce(new Error('Resend outage'));

            await expect(
                emailService.sendInviteEmail(inviteOpts)
            ).resolves.toBeUndefined();
            expect(hoisted.logger.warn).toHaveBeenCalledWith(
                { to: 'tester@example.com', err: expect.any(Error) },
                'Failed to send invite email'
            );
        });
    });
});

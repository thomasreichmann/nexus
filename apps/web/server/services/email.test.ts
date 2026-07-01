import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    type MockDb,
    type MockDbMocks,
    createUserFixture,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { mockEmail } from '@/lib/email/testing';
import { NotFoundError } from '@/server/errors';
import { emailService } from './email';

vi.mock('@/lib/email', () => ({
    email: mockEmail,
}));

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

        it('throws NotFoundError when the user does not exist', async () => {
            mocks.user.findFirst.mockResolvedValue(undefined);

            await expect(
                emailService.sendRetrievalReadyEmail(db, opts)
            ).rejects.toThrow(NotFoundError);
            expect(mockEmail.send).not.toHaveBeenCalled();
        });
    });
});

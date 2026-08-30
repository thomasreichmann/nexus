import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb, type MockDb, type MockDbMocks } from '@nexus/db/testing';
import { mockEmail } from '@nexus/email/testing';

vi.mock('@nexus/email', () => ({ email: mockEmail }));

import { retrievalRequestUrl, sendRetrievalRequestReadyEmail } from './email';

const OPTS = {
    userId: 'user-1',
    requestId: 'request-1',
    fileCount: 12,
    partCount: 3,
    totalBytes: 10_000,
    expiresAt: new Date('2026-09-06T10:00:00Z'),
};

describe('retrievalRequestUrl', () => {
    // The app parses this in app/(dashboard)/dashboard/files/page.tsx; the two
    // halves live in different packages and nothing else keeps them in step.
    it('deep-links into the file browser by request', () => {
        expect(retrievalRequestUrl('https://nexus.test', 'req-1')).toBe(
            'https://nexus.test/dashboard/files?request=req-1'
        );
    });

    it('tolerates a trailing slash on APP_URL', () => {
        expect(retrievalRequestUrl('https://nexus.test/', 'req-1')).toBe(
            'https://nexus.test/dashboard/files?request=req-1'
        );
    });
});

describe('sendRetrievalRequestReadyEmail', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.APP_URL = 'https://nexus.test';

        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        mocks.user.findFirst.mockResolvedValue({
            id: 'user-1',
            email: 'photographer@example.com',
        });
    });

    it('sends the multi-part template to the requesting user', async () => {
        await sendRetrievalRequestReadyEmail(db, OPTS);

        expect(mockEmail.send).toHaveBeenCalledTimes(1);
        const [sent] = mockEmail.send.mock.calls[0];
        expect(sent.to).toBe('photographer@example.com');
        expect(sent.subject).toBe('Your 12 files are ready to download');
        expect(sent.react.props).toMatchObject({
            downloadUrl: 'https://nexus.test/dashboard/files?request=request-1',
            fileCount: 12,
            partCount: 3,
        });
    });

    // The webhook-era contract (apps/web/server/services/email.ts): the request
    // is already complete and its zips already downloadable, so a Resend outage
    // must not fail the job that finished the work.
    it('swallows a send failure', async () => {
        mockEmail.send.mockRejectedValue(new Error('Resend is down'));

        await expect(
            sendRetrievalRequestReadyEmail(db, OPTS)
        ).resolves.toBeUndefined();
    });

    it('skips silently when the user is gone', async () => {
        mocks.user.findFirst.mockResolvedValue(undefined);

        await sendRetrievalRequestReadyEmail(db, OPTS);

        expect(mockEmail.send).not.toHaveBeenCalled();
    });
});

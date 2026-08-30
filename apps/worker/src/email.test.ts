import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb, type MockDb, type MockDbMocks } from '@nexus/db/testing';
import { mockEmail } from '@nexus/email/testing';

vi.mock('@nexus/email', () => ({ email: mockEmail }));

import {
    retrievalFileUrl,
    retrievalRequestUrl,
    sendRetrievalFileReadyEmail,
    sendRetrievalRequestReadyEmail,
} from './email';

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

describe('retrievalFileUrl', () => {
    // The app parses this in app/(dashboard)/dashboard/files/page.tsx (`?file=`
    // scrolls to and highlights the restored file); same cross-package pact as
    // retrievalRequestUrl above.
    it('deep-links into the file browser by file', () => {
        expect(retrievalFileUrl('https://nexus.test', 'file-1')).toBe(
            'https://nexus.test/dashboard/files?file=file-1'
        );
    });

    it('tolerates a trailing slash on APP_URL', () => {
        expect(retrievalFileUrl('https://nexus.test/', 'file-1')).toBe(
            'https://nexus.test/dashboard/files?file=file-1'
        );
    });
});

describe('sendRetrievalFileReadyEmail', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    const FILE_OPTS = {
        userId: 'user-1',
        requestId: 'request-1',
        fileId: 'file-1',
        fileName: 'shoot.cr2',
        expiresAt: new Date('2026-09-06T10:00:00Z'),
    };

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

    it('sends the single-file template to the requesting user', async () => {
        await sendRetrievalFileReadyEmail(db, FILE_OPTS);

        expect(mockEmail.send).toHaveBeenCalledTimes(1);
        const [sent] = mockEmail.send.mock.calls[0];
        expect(sent.to).toBe('photographer@example.com');
        expect(sent.subject).toBe('Your file "shoot.cr2" is ready to download');
        expect(sent.react.props).toMatchObject({
            fileName: 'shoot.cr2',
            downloadUrl: 'https://nexus.test/dashboard/files?file=file-1',
            expiresAt: FILE_OPTS.expiresAt,
        });
    });

    // The same webhook-era contract as the request-level send: the file is
    // already downloadable, so a Resend outage must not fail the poll run
    // that completed the request.
    it('swallows a send failure', async () => {
        mockEmail.send.mockRejectedValue(new Error('Resend is down'));

        await expect(
            sendRetrievalFileReadyEmail(db, FILE_OPTS)
        ).resolves.toBeUndefined();
    });

    it('skips silently when the user is gone', async () => {
        mocks.user.findFirst.mockResolvedValue(undefined);

        await sendRetrievalFileReadyEmail(db, FILE_OPTS);

        expect(mockEmail.send).not.toHaveBeenCalled();
    });

    // The email's one time-sensitive claim is the expiry date; a row without
    // one (pre-#424, hand-seeded) gets no email rather than an invented date.
    it('skips rather than inventing an expiry on a null window', async () => {
        await sendRetrievalFileReadyEmail(db, {
            ...FILE_OPTS,
            expiresAt: null,
        });

        expect(mockEmail.send).not.toHaveBeenCalled();
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

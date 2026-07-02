import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    createMockDb,
    createInviteFixture,
    TEST_ADMIN_USER_ID,
    TEST_INVITE_ID,
    TEST_INVITE_TOKEN,
    type MockDb,
    type MockDbMocks,
} from '@nexus/db/testing';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return {
        logger: createMockLogger(),
        sendInviteEmail: vi.fn(async (): Promise<void> => {}),
    };
});

vi.mock('@/lib/env', () => ({
    env: { NEXT_PUBLIC_APP_URL: 'https://test.example' },
}));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

vi.mock('@/server/services/email', () => ({
    emailService: { sendInviteEmail: hoisted.sendInviteEmail },
}));

import { NotFoundError, InvalidStateError } from '@/server/errors';
import { inviteService } from './invites';

describe('inviteService.createInvite', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
        mocks.returning.mockResolvedValue([createInviteFixture()]);
    });

    function insertedRow(callIndex = 0): Record<string, unknown> {
        return mocks.values.mock.calls[callIndex][0];
    }

    it('generates a base64url token with 32 bytes of entropy', async () => {
        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
        });

        // 32 random bytes → exactly 43 base64url chars, no padding
        expect(insertedRow().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('generates a distinct token per invite', async () => {
        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
        });
        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
        });

        expect(insertedRow(0).token).not.toBe(insertedRow(1).token);
    });

    it('defaults email, storageLimit, and expiresAt to null', async () => {
        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
        });

        expect(mocks.values).toHaveBeenCalledWith(
            expect.objectContaining({
                createdBy: TEST_ADMIN_USER_ID,
                email: null,
                storageLimit: null,
                expiresAt: null,
            })
        );
    });

    it('passes optional email binding, storage override, and expiry through', async () => {
        const expiresAt = new Date('2026-08-01T00:00:00Z');

        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
            email: 'tester@example.com',
            storageLimit: 20 * 1024 ** 4,
            expiresAt,
        });

        expect(mocks.values).toHaveBeenCalledWith(
            expect.objectContaining({
                email: 'tester@example.com',
                storageLimit: 20 * 1024 ** 4,
                expiresAt,
            })
        );
    });

    it('returns the redemption link for the created invite', async () => {
        const { url } = await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
        });

        expect(url).toBe(`https://test.example/invite/${TEST_INVITE_TOKEN}`);
    });

    it('emails the invite link to an email-bound invite', async () => {
        const expiresAt = new Date('2026-08-01T00:00:00Z');
        mocks.returning.mockResolvedValue([
            createInviteFixture({ email: 'tester@example.com', expiresAt }),
        ]);

        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
            email: 'tester@example.com',
            expiresAt,
        });

        expect(hoisted.sendInviteEmail).toHaveBeenCalledOnce();
        expect(hoisted.sendInviteEmail).toHaveBeenCalledWith({
            to: 'tester@example.com',
            inviteUrl: `https://test.example/invite/${TEST_INVITE_TOKEN}`,
            expiresAt,
        });
    });

    it('does not send an email for an unbound invite', async () => {
        await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
        });

        expect(hoisted.sendInviteEmail).not.toHaveBeenCalled();
    });

    it('still creates the invite and returns the link when the email fails', async () => {
        mocks.returning.mockResolvedValue([
            createInviteFixture({ email: 'tester@example.com' }),
        ]);
        hoisted.sendInviteEmail.mockRejectedValueOnce(
            new Error('Resend outage')
        );

        const { invite, url } = await inviteService.createInvite(db, {
            createdBy: TEST_ADMIN_USER_ID,
            email: 'tester@example.com',
        });

        expect(invite.id).toBe(TEST_INVITE_ID);
        expect(url).toBe(`https://test.example/invite/${TEST_INVITE_TOKEN}`);
        expect(hoisted.logger.error).toHaveBeenCalledWith(
            { err: expect.any(Error), inviteId: TEST_INVITE_ID },
            'Invite email failed after invite creation'
        );
    });
});

describe('inviteService.getInviteRedemption', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    it('returns valid with a null email for an unbound pending invite', async () => {
        mocks.invites.findFirst.mockResolvedValue(createInviteFixture());

        const result = await inviteService.getInviteRedemption(
            db,
            TEST_INVITE_TOKEN
        );

        expect(result).toEqual({ status: 'valid', email: null });
    });

    it('returns the bound email for an email-bound pending invite', async () => {
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ email: 'tester@example.com' })
        );

        const result = await inviteService.getInviteRedemption(
            db,
            TEST_INVITE_TOKEN
        );

        expect(result).toEqual({
            status: 'valid',
            email: 'tester@example.com',
        });
    });

    it('treats a pending invite with a future expiry as valid', async () => {
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ expiresAt: new Date(Date.now() + 60_000) })
        );

        const result = await inviteService.getInviteRedemption(
            db,
            TEST_INVITE_TOKEN
        );

        expect(result).toEqual({ status: 'valid', email: null });
    });

    it('returns invalid for an unknown token', async () => {
        mocks.invites.findFirst.mockResolvedValue(undefined);

        const result = await inviteService.getInviteRedemption(db, 'missing');

        expect(result).toEqual({ status: 'invalid' });
    });

    it('returns expired for a pending invite past its expiry', async () => {
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ expiresAt: new Date(Date.now() - 60_000) })
        );

        const result = await inviteService.getInviteRedemption(
            db,
            TEST_INVITE_TOKEN
        );

        expect(result).toEqual({ status: 'expired' });
    });

    it.each(['redeemed', 'revoked'] as const)(
        'returns %s for a %s invite',
        async (status) => {
            mocks.invites.findFirst.mockResolvedValue(
                createInviteFixture({ status })
            );

            const result = await inviteService.getInviteRedemption(
                db,
                TEST_INVITE_TOKEN
            );

            expect(result).toEqual({ status });
        }
    );
});

describe('inviteService.revokeInvite', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        vi.clearAllMocks();
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    it('revokes a pending invite', async () => {
        const revoked = createInviteFixture({ status: 'revoked' });
        mocks.returning.mockResolvedValue([revoked]);

        const result = await inviteService.revokeInvite(db, TEST_INVITE_ID);

        expect(mocks.set).toHaveBeenCalledWith({ status: 'revoked' });
        expect(result).toBe(revoked);
    });

    it('throws NotFoundError when the invite does not exist', async () => {
        mocks.returning.mockResolvedValue([]);
        mocks.invites.findFirst.mockResolvedValue(undefined);

        await expect(inviteService.revokeInvite(db, 'missing')).rejects.toThrow(
            NotFoundError
        );
    });

    it('throws InvalidStateError when the invite is already redeemed', async () => {
        mocks.returning.mockResolvedValue([]);
        mocks.invites.findFirst.mockResolvedValue(
            createInviteFixture({ status: 'redeemed' })
        );

        await expect(
            inviteService.revokeInvite(db, TEST_INVITE_ID)
        ).rejects.toThrow(InvalidStateError);
    });
});

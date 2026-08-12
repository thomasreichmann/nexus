import { describe, expect, it } from 'vitest';
import { isInviteExpired } from './invites';

const NOW = new Date('2026-08-12T12:00:00Z');
const PAST = new Date('2026-08-11T12:00:00Z');
const FUTURE = new Date('2026-08-13T12:00:00Z');

describe('isInviteExpired', () => {
    it('is true for a pending invite past its expiry', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: PAST }, NOW)
        ).toBe(true);
    });

    it('is false for a pending invite that has not reached its expiry', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: FUTURE }, NOW)
        ).toBe(false);
    });

    it('treats a null expiry as never expiring', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: null }, NOW)
        ).toBe(false);
    });

    it('expires exactly at the boundary', () => {
        expect(
            isInviteExpired({ status: 'pending', expiresAt: NOW }, NOW)
        ).toBe(true);
    });

    // Redeemed and revoked are terminal — an elapsed expiry must not relabel
    // them, or the admin list would report a used invite as expired.
    it('is false for non-pending invites regardless of expiry', () => {
        expect(
            isInviteExpired({ status: 'redeemed', expiresAt: PAST }, NOW)
        ).toBe(false);
        expect(
            isInviteExpired({ status: 'revoked', expiresAt: PAST }, NOW)
        ).toBe(false);
    });
});

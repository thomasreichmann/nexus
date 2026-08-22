import { describe, expect, it } from 'vitest';
import {
    interpretObjectState,
    isProbablyCold,
    isReadable,
    LIFECYCLE_TRANSITION_LAG_HOURS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from './objectState';

const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000);

describe('interpretObjectState', () => {
    // S3 omits StorageClass for STANDARD rather than sending it, so an absent
    // header is the normal warm case, not a missing-data case.
    it('reads an absent storage class as warm', () => {
        expect(interpretObjectState({})).toEqual({
            availability: 'warm',
            storageClass: undefined,
        });
    });

    it('reads a non-archival storage class as warm', () => {
        expect(interpretObjectState({ storageClass: 'GLACIER_IR' })).toEqual({
            availability: 'warm',
            storageClass: 'GLACIER_IR',
        });
    });

    it('reads an archival class with no restore header as archived', () => {
        expect(interpretObjectState({ storageClass: 'DEEP_ARCHIVE' })).toEqual({
            availability: 'archived',
            storageClass: 'DEEP_ARCHIVE',
        });
    });

    it('reads an ongoing request as restoring', () => {
        expect(
            interpretObjectState({
                storageClass: 'DEEP_ARCHIVE',
                restoreHeader: 'ongoing-request="true"',
            })
        ).toEqual({ availability: 'restoring', storageClass: 'DEEP_ARCHIVE' });
    });

    it('reads a finished restore as restored, with its expiry', () => {
        const state = interpretObjectState({
            storageClass: 'DEEP_ARCHIVE',
            restoreHeader:
                'ongoing-request="false", expiry-date="Fri, 29 Aug 2026 00:00:00 GMT"',
        });
        expect(state.availability).toBe('restored');
        expect(state.expiresAt).toEqual(
            new Date('Fri, 29 Aug 2026 00:00:00 GMT')
        );
    });

    // Better a restored object with an unknown expiry than one we refuse to
    // serve — the retrieval row falls back to a synthetic window.
    it('reads a finished restore with no expiry-date as restored', () => {
        const state = interpretObjectState({
            storageClass: 'GLACIER',
            restoreHeader: 'ongoing-request="false"',
        });
        expect(state.availability).toBe('restored');
        expect(state.expiresAt).toBeUndefined();
    });
});

describe('isReadable', () => {
    it('is true exactly for the states S3 will serve bytes for', () => {
        expect(isReadable({ availability: 'warm' })).toBe(true);
        expect(isReadable({ availability: 'restored' })).toBe(true);
        expect(isReadable({ availability: 'archived' })).toBe(false);
        expect(isReadable({ availability: 'restoring' })).toBe(false);
    });
});

describe('isProbablyCold', () => {
    const big = LIFECYCLE_TRANSITION_MIN_BYTES + 1;
    const old = hoursAgo(LIFECYCLE_TRANSITION_LAG_HOURS + 1);

    it('is true for a large file past the lifecycle window', () => {
        expect(isProbablyCold({ size: big, createdAt: old })).toBe(true);
    });

    it('is false for a fresh file the sweep has not reached', () => {
        expect(isProbablyCold({ size: big, createdAt: hoursAgo(1) })).toBe(
            false
        );
    });

    // S3 never transitions objects at or below the floor, so a small file is
    // warm however old it gets.
    it('is false at the size floor regardless of age', () => {
        expect(
            isProbablyCold({
                size: LIFECYCLE_TRANSITION_MIN_BYTES,
                createdAt: old,
            })
        ).toBe(false);
    });
});

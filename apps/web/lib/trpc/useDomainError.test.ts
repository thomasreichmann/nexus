import { describe, expect, it } from 'vitest';

import { makeClientError } from './testing';
import { useDomainError } from './useDomainError';

describe('useDomainError', () => {
    it('returns null for null/undefined input', () => {
        expect(useDomainError(null)).toBeNull();
        expect(useDomainError(undefined)).toBeNull();
    });

    it('returns null when the error has no domainCode (bare TRPCError)', () => {
        expect(
            useDomainError(makeClientError({ code: 'UNAUTHORIZED' }))
        ).toBeNull();
    });

    it('returns typed info when the error carries a domainCode', () => {
        const err = makeClientError({
            code: 'FORBIDDEN',
            domainCode: 'TRIAL_EXPIRED',
            message: 'trial gone',
        });

        expect(useDomainError(err)).toEqual({
            code: 'TRIAL_EXPIRED',
            message: 'trial gone',
        });
    });

    it('discriminates errors that share a tRPC code', () => {
        const forbidden = useDomainError(
            makeClientError({ code: 'FORBIDDEN', domainCode: 'FORBIDDEN' })
        );
        const trialExpired = useDomainError(
            makeClientError({ code: 'FORBIDDEN', domainCode: 'TRIAL_EXPIRED' })
        );

        expect(forbidden?.code).toBe('FORBIDDEN');
        expect(trialExpired?.code).toBe('TRIAL_EXPIRED');
    });
});

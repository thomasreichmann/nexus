import { describe, expect, it } from 'vitest';

import { makeClientError } from './test-fixtures';
import { getDomainError } from './get-domain-error';

describe('getDomainError', () => {
    it('returns null for null/undefined input', () => {
        expect(getDomainError(null)).toBeNull();
        expect(getDomainError(undefined)).toBeNull();
    });

    it('returns null when the error has no domainCode (bare TRPCError)', () => {
        expect(
            getDomainError(makeClientError({ code: 'UNAUTHORIZED' }))
        ).toBeNull();
    });

    it('returns typed info when the error carries a domainCode', () => {
        const err = makeClientError({
            code: 'FORBIDDEN',
            domainCode: 'TRIAL_EXPIRED',
            message: 'trial gone',
        });

        expect(getDomainError(err)).toEqual({
            code: 'TRIAL_EXPIRED',
            message: 'trial gone',
        });
    });

    it('discriminates errors that share a tRPC code', () => {
        const forbidden = getDomainError(
            makeClientError({ code: 'FORBIDDEN', domainCode: 'FORBIDDEN' })
        );
        const trialExpired = getDomainError(
            makeClientError({ code: 'FORBIDDEN', domainCode: 'TRIAL_EXPIRED' })
        );

        expect(forbidden?.code).toBe('FORBIDDEN');
        expect(trialExpired?.code).toBe('TRIAL_EXPIRED');
    });
});

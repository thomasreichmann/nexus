import { describe, expect, it } from 'vitest';
import { TRPCClientError } from '@trpc/client';

import type { AppRouter } from '@/server/trpc/router';
import { getToastId } from './error-link';
import { makeClientError } from './testing';

describe('getToastId', () => {
    it('returns distinct ids for two DomainErrors sharing a tRPC code', () => {
        const forbidden = makeClientError({
            code: 'FORBIDDEN',
            domainCode: 'FORBIDDEN',
        });
        const trialExpired = makeClientError({
            code: 'FORBIDDEN',
            domainCode: 'TRIAL_EXPIRED',
        });

        expect(getToastId(forbidden)).not.toBe(getToastId(trialExpired));
        expect(getToastId(forbidden)).toBe('trpc-FORBIDDEN-FORBIDDEN');
        expect(getToastId(trialExpired)).toBe('trpc-FORBIDDEN-TRIAL_EXPIRED');
    });

    it('collapses two errors with the same tRPC code and domainCode into one toast id', () => {
        const a = makeClientError({
            code: 'NOT_FOUND',
            domainCode: 'NOT_FOUND',
        });
        const b = makeClientError({
            code: 'NOT_FOUND',
            domainCode: 'NOT_FOUND',
        });

        expect(getToastId(a)).toBe(getToastId(b));
    });

    it('falls back gracefully when domainCode is absent (bare TRPCError)', () => {
        const bare = makeClientError({ code: 'UNAUTHORIZED' });

        expect(getToastId(bare)).toBe('trpc-UNAUTHORIZED-');
    });

    it('falls back to INTERNAL_SERVER_ERROR when data is missing', () => {
        const err = new TRPCClientError<AppRouter>('boom');

        expect(getToastId(err)).toBe('trpc-INTERNAL_SERVER_ERROR-');
    });
});

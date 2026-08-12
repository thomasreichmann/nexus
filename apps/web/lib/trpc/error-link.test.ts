import { describe, expect, it } from 'vitest';
import { TRPCClientError } from '@trpc/client';

import type { AppRouter } from '@/server/trpc/router';
import { getErrorMessage, getToastId } from './error-link';
import { makeClientError } from './test-fixtures';

describe('getErrorMessage', () => {
    it('replaces the log-oriented NOT_FOUND server message with user copy', () => {
        const err = makeClientError({
            code: 'NOT_FOUND',
            domainCode: 'NOT_FOUND',
            message: 'File not found: 123e4567-e89b-12d3-a456-426614174000',
        });

        expect(getErrorMessage(err)).toBe('That item is no longer available');
        // The domain copy also beats a call-site fallback — it is more
        // specific than any per-mutation generic.
        expect(getErrorMessage(err, 'Failed to request retrieval')).toBe(
            'That item is no longer available'
        );
    });

    it('passes a DomainError message through when no copy is mapped', () => {
        const err = makeClientError({
            code: 'BAD_REQUEST',
            domainCode: 'INVALID_STATE',
            message:
                'File is not available for retrieval (current status: uploading)',
        });

        expect(getErrorMessage(err, 'Failed to request retrieval')).toBe(
            'File is not available for retrieval (current status: uploading)'
        );
    });

    it('uses the context message instead of the generic for 500s', () => {
        const err = makeClientError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'connect ECONNREFUSED 127.0.0.1:5432',
        });

        expect(getErrorMessage(err)).toBe(
            'Something went wrong. Please try again'
        );
        expect(getErrorMessage(err, 'Failed to request retrieval')).toBe(
            'Failed to request retrieval'
        );
    });

    it('uses the context message for transport errors with no response data', () => {
        const err = new TRPCClientError<AppRouter>('fetch failed');

        expect(getErrorMessage(err, 'Failed to request retrieval')).toBe(
            'Failed to request retrieval'
        );
    });

    it('prefers code-specific copy over the context message when the server message is empty', () => {
        const err = makeClientError({ code: 'UNAUTHORIZED', message: '' });

        expect(getErrorMessage(err, 'Failed to request retrieval')).toBe(
            'Please sign in to continue'
        );
    });
});

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

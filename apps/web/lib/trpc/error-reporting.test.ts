import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TRPCClientError } from '@trpc/client';

const hoisted = await vi.hoisted(async () => {
    const { createMockSentry } = await import('@/lib/sentry/testing');
    return { sentry: createMockSentry() };
});

vi.mock('@sentry/nextjs', () => hoisted.sentry);

import {
    isUnexpectedClientError,
    reportUnexpectedClientError,
} from './error-reporting';
import { makeClientError } from './test-fixtures';

describe('isUnexpectedClientError', () => {
    it('returns false for domain errors', () => {
        const error = makeClientError({
            code: 'PRECONDITION_FAILED',
            domainCode: 'QUOTA_EXCEEDED',
        });
        expect(isUnexpectedClientError(error)).toBe(false);
    });

    it('returns false for input validation and auth-gate rejections', () => {
        for (const code of ['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN']) {
            expect(isUnexpectedClientError(makeClientError({ code }))).toBe(
                false
            );
        }
    });

    it('returns true for server 500s', () => {
        const error = makeClientError({
            code: 'INTERNAL_SERVER_ERROR',
            httpStatus: 500,
        });
        expect(isUnexpectedClientError(error)).toBe(true);
    });

    it('returns true for network failures that never reached the server', () => {
        const error = TRPCClientError.from(new TypeError('Failed to fetch'));
        expect(isUnexpectedClientError(error)).toBe(true);
    });

    it('returns true for non-tRPC errors', () => {
        expect(isUnexpectedClientError(new Error('cache exploded'))).toBe(true);
    });
});

describe('reportUnexpectedClientError', () => {
    beforeEach(() => {
        hoisted.sentry.captureException.mockClear();
    });

    it('captures unexpected errors with the cache context', () => {
        const error = makeClientError({ code: 'INTERNAL_SERVER_ERROR' });
        reportUnexpectedClientError(error, { queryKey: ['files', 'list'] });

        expect(hoisted.sentry.captureException).toHaveBeenCalledOnce();
        const [captured, options] = hoisted.sentry.captureException.mock.calls[0]!;
        expect(captured).toBe(error);
        expect(options.contexts.trpc).toEqual({
            queryKey: ['files', 'list'],
        });
    });

    it('skips expected errors', () => {
        const error = makeClientError({
            code: 'FORBIDDEN',
            domainCode: 'TRIAL_EXPIRED',
        });
        reportUnexpectedClientError(error, { mutationKey: ['upload'] });

        expect(hoisted.sentry.captureException).not.toHaveBeenCalled();
    });
});

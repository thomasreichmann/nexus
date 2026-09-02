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

    // #400: a Zod failure is a BAD_REQUEST with no domainCode, so the raw
    // issue array — Zod v4 serializes the whole list into `message` — used to
    // reach the toast verbatim.
    it('falls back to the context message for a raw Zod issue payload', () => {
        const err = makeClientError({
            code: 'BAD_REQUEST',
            message: JSON.stringify(
                [
                    {
                        origin: 'array',
                        code: 'too_big',
                        maximum: 100,
                        inclusive: true,
                        path: ['ids'],
                        message: 'Too big: expected array to have <=100 items',
                    },
                ],
                null,
                2
            ),
        });

        expect(getErrorMessage(err, 'Failed to delete files')).toBe(
            'Failed to delete files'
        );
        expect(getErrorMessage(err)).toBe(
            'Something went wrong. Please try again'
        );
    });

    it('falls back for a serialized object and for a stack trace', () => {
        const objectDump = makeClientError({
            code: 'BAD_REQUEST',
            message: '{\n  "code": "too_big",\n  "maximum": 100\n}',
        });
        const stack = makeClientError({
            code: 'BAD_REQUEST',
            message:
                'TypeError: Cannot read properties of undefined\n' +
                '    at deleteMany (/var/task/server/trpc/routers/files.ts:149:20)',
        });

        expect(getErrorMessage(objectDump)).toBe(
            'Something went wrong. Please try again'
        );
        expect(getErrorMessage(stack)).toBe(
            'Something went wrong. Please try again'
        );
    });

    it('still shows code-specific copy over the generic when the server message is unreadable', () => {
        const err = makeClientError({
            code: 'UNAUTHORIZED',
            message: '[{ "code": "unauthorized" }]',
        });

        expect(getErrorMessage(err)).toBe('Please sign in to continue');
    });

    // Guards against an over-eager sanitizer: prose that merely mentions
    // punctuation or the word "at" is still prose.
    it('leaves human-readable messages alone', () => {
        const messages = [
            'File is not available for retrieval (current status: uploading)',
            'Your trial ended at 12:00 — pick a plan to keep uploading',
            '[Beta] Bulk retrieval is limited during the alpha',
            // Opens with a bracket and quotes a key — prose all the same,
            // which is why the gate parses rather than pattern-matches.
            '[Beta] Retrieval limits: {"max": 100} until launch',
        ];

        for (const message of messages) {
            const err = makeClientError({ code: 'BAD_REQUEST', message });
            expect(getErrorMessage(err, 'Failed to delete files')).toBe(
                message
            );
        }
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

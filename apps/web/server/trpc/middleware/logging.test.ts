import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// Mock the logger module so we can control errorVerbosity per test
const mockLogger = {
    errorVerbosity: 'full' as 'minimal' | 'standard' | 'full',
};

vi.mock('@/server/lib/logger', () => ({
    get errorVerbosity() {
        return mockLogger.errorVerbosity;
    },
    isDev: true,
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

import {
    formatError,
    formatZodMessage,
    isZodError,
    trimStackTrace,
} from './logging';

beforeEach(() => {
    mockLogger.errorVerbosity = 'full';
});

/** Create a real ZodError by parsing invalid data. */
function createZodError(
    schema: z.ZodType,
    data: unknown
): Error & { issues: unknown[] } {
    try {
        schema.parse(data);
        throw new Error('Expected parse to fail');
    } catch (error) {
        if (isZodError(error)) return error;
        throw error;
    }
}

describe('isZodError', () => {
    it('returns true for real ZodErrors', () => {
        const zodError = createZodError(z.object({ name: z.string() }), {});
        expect(isZodError(zodError)).toBe(true);
    });

    it('returns false for plain Errors', () => {
        expect(isZodError(new Error('plain'))).toBe(false);
    });

    it('returns false for non-Error objects with issues', () => {
        expect(isZodError({ issues: [] })).toBe(false);
    });

    it('returns false for Errors with non-array issues', () => {
        const error = new Error('bad');
        (error as unknown as { issues: string }).issues = 'not-an-array';
        expect(isZodError(error)).toBe(false);
    });
});

describe('formatZodMessage', () => {
    it('formats a single issue', () => {
        const msg = formatZodMessage([{ path: ['name'], message: 'Required' }]);
        expect(msg).toBe('Zod validation failed (1 issue)\n  - name: Required');
    });

    it('formats multiple issues with dot-joined paths', () => {
        const msg = formatZodMessage([
            { path: ['name'], message: 'Expected string, received undefined' },
            {
                path: ['sizeBytes'],
                message: 'Expected number, received undefined',
            },
        ]);
        expect(msg).toContain('2 issues');
        expect(msg).toContain('  - name: Expected string, received undefined');
        expect(msg).toContain(
            '  - sizeBytes: Expected number, received undefined'
        );
    });

    it('formats root-level issues with (root)', () => {
        const msg = formatZodMessage([{ path: [], message: 'Invalid input' }]);
        expect(msg).toContain('  - (root): Invalid input');
    });

    it('joins nested paths with dots', () => {
        const msg = formatZodMessage([
            { path: ['meta', 'tags', 0], message: 'Expected string' },
        ]);
        expect(msg).toContain('  - meta.tags.0: Expected string');
    });
});

describe('trimStackTrace', () => {
    it('returns undefined for undefined input', () => {
        expect(trimStackTrace(undefined)).toBeUndefined();
    });

    it('keeps the error line and at-lines, strips code frames', () => {
        const stack = [
            'Error: something',
            '    at Object.<anonymous> (/app/server.ts:10:5)',
            '       const x = 1;',
            '             ^',
            '    at Module._compile (node:internal/modules:1:2)',
        ].join('\n');

        const trimmed = trimStackTrace(stack);
        expect(trimmed).toBe(
            [
                'Error: something',
                '    at Object.<anonymous> (/app/server.ts:10:5)',
                '    at Module._compile (node:internal/modules:1:2)',
            ].join('\n')
        );
    });
});

describe('formatError', () => {
    describe('with ZodError cause (full verbosity)', () => {
        it('formats ZodError cause as compact message', () => {
            const zodError = createZodError(
                z.object({ name: z.string(), sizeBytes: z.number() }),
                {}
            );

            const trpcError = new TRPCError({
                code: 'BAD_REQUEST',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result.code).toBe('BAD_REQUEST');
            expect(result.message).toContain('Zod validation failed');
            expect(result.message).toContain('2 issues');
            expect(result.message).toContain('name:');
            expect(result.message).toContain('sizeBytes:');
        });

        it('suppresses ZodError cause to eliminate duplication', () => {
            const zodError = createZodError(z.string(), 42);

            const trpcError = new TRPCError({
                code: 'BAD_REQUEST',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result.cause).toBeUndefined();
        });

        it('omits stack trace for input validation (BAD_REQUEST)', () => {
            const zodError = createZodError(z.string(), 42);

            const trpcError = new TRPCError({
                code: 'BAD_REQUEST',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result.stack).toBeUndefined();
        });
    });

    describe('with ZodError cause from internal validation (full verbosity)', () => {
        it('keeps trimmed stack trace for non-BAD_REQUEST codes', () => {
            const zodError = createZodError(z.string(), 42);

            const trpcError = new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result.stack).toBeDefined();
            // Stack should have no code frame lines
            const lines = result.stack!.split('\n');
            for (const line of lines) {
                expect(line).toMatch(/^\S|^\s+at /);
            }
        });

        it('still formats issues compactly', () => {
            const zodError = createZodError(
                z.object({ field: z.string() }),
                {}
            );

            const trpcError = new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result.message).toContain('Zod validation failed');
            expect(result.cause).toBeUndefined();
        });
    });

    describe('with non-Zod cause (full verbosity)', () => {
        it('includes full cause chain', () => {
            const innerError = new Error('db connection failed');
            const trpcError = new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Something went wrong',
                cause: innerError,
            });

            const result = formatError(trpcError);

            expect(result.code).toBe('INTERNAL_SERVER_ERROR');
            expect(result.message).toBe('Something went wrong');
            expect(result.cause).toBeDefined();
            expect(result.cause!.code).toBe('Error');
            expect(result.cause!.message).toBe('db connection failed');
        });

        it('includes full stack trace with code frames', () => {
            const trpcError = new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'fail',
            });

            const result = formatError(trpcError);

            expect(result.stack).toBe(trpcError.stack);
        });
    });

    describe('standard verbosity', () => {
        beforeEach(() => {
            mockLogger.errorVerbosity = 'standard';
        });

        it('includes message but no stack or cause', () => {
            const zodError = createZodError(z.string(), 42);
            const trpcError = new TRPCError({
                code: 'BAD_REQUEST',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result.code).toBe('BAD_REQUEST');
            expect(result.message).toBeDefined();
            expect(result.stack).toBeUndefined();
            expect(result.cause).toBeUndefined();
        });
    });

    describe('minimal verbosity', () => {
        beforeEach(() => {
            mockLogger.errorVerbosity = 'minimal';
        });

        it('includes only code', () => {
            const zodError = createZodError(z.string(), 42);
            const trpcError = new TRPCError({
                code: 'BAD_REQUEST',
                cause: zodError,
            });

            const result = formatError(trpcError);

            expect(result).toEqual({ code: 'BAD_REQUEST' });
        });
    });
});

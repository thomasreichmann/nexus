import { describe, expect, it } from 'vitest';
import { initTRPC, TRPCError } from '@trpc/server';
import type { TRPCDefaultErrorShape } from '@trpc/server';
import {
    isDomainError,
    NotFoundError,
    ForbiddenError,
    InvalidStateError,
    QuotaExceededError,
    TrialExpiredError,
} from '@/server/errors';
import { domainErrorFormatter } from '../error-formatter';

// Minimal tRPC setup for testing the middleware
const t = initTRPC.create();

// Create the error handler middleware - replicating init.ts pattern
function createErrorHandlerMiddleware() {
    return t.middleware(async ({ next }) => {
        const result = await next();

        if (!result.ok) {
            // Check if the cause is a DomainError
            const cause = result.error.cause;
            if (isDomainError(cause)) {
                throw new TRPCError({
                    code: cause.trpcCode,
                    message: cause.message,
                    cause: cause,
                });
            }
        }

        return result;
    });
}

const errorHandlerMiddleware = createErrorHandlerMiddleware();
const baseProcedure = t.procedure.use(errorHandlerMiddleware);

describe('errorHandlerMiddleware', () => {
    it('maps NotFoundError to NOT_FOUND TRPCError', async () => {
        const router = t.router({
            test: baseProcedure.query(() => {
                throw new NotFoundError('File', 'abc-123');
            }),
        });

        const caller = router.createCaller({});

        try {
            await caller.test();
            expect.fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TRPCError);
            expect((error as TRPCError).code).toBe('NOT_FOUND');
            expect((error as TRPCError).message).toBe(
                'File not found: abc-123'
            );
        }
    });

    it('maps ForbiddenError to FORBIDDEN TRPCError', async () => {
        const router = t.router({
            test: baseProcedure.query(() => {
                throw new ForbiddenError('Cannot access this resource');
            }),
        });

        const caller = router.createCaller({});

        try {
            await caller.test();
            expect.fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TRPCError);
            expect((error as TRPCError).code).toBe('FORBIDDEN');
            expect((error as TRPCError).message).toBe(
                'Cannot access this resource'
            );
        }
    });

    it('maps InvalidStateError to BAD_REQUEST TRPCError', async () => {
        const router = t.router({
            test: baseProcedure.query(() => {
                throw new InvalidStateError('Retrieval already in progress');
            }),
        });

        const caller = router.createCaller({});

        try {
            await caller.test();
            expect.fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TRPCError);
            expect((error as TRPCError).code).toBe('BAD_REQUEST');
            expect((error as TRPCError).message).toBe(
                'Retrieval already in progress'
            );
        }
    });

    it('maps QuotaExceededError to PRECONDITION_FAILED TRPCError', async () => {
        const router = t.router({
            test: baseProcedure.query(() => {
                throw new QuotaExceededError({
                    usedBytes: 100,
                    limitBytes: 50,
                    requestedBytes: 10,
                });
            }),
        });

        const caller = router.createCaller({});

        try {
            await caller.test();
            expect.fail('Should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(TRPCError);
            expect((error as TRPCError).code).toBe('PRECONDITION_FAILED');
            expect((error as TRPCError).message).toContain(
                'Storage quota exceeded'
            );
        }
    });

    it('preserves original DomainError as cause', async () => {
        const originalError = new NotFoundError('File', 'abc-123');

        const router = t.router({
            test: baseProcedure.query(() => {
                throw originalError;
            }),
        });

        const caller = router.createCaller({});

        try {
            await caller.test();
            expect.fail('Should have thrown');
        } catch (error) {
            expect((error as TRPCError).cause).toBe(originalError);
        }
    });

    it('wraps non-DomainError as INTERNAL_SERVER_ERROR', async () => {
        const genericError = new Error('Something went wrong');

        const router = t.router({
            test: baseProcedure.query(() => {
                throw genericError;
            }),
        });

        const caller = router.createCaller({});

        try {
            await caller.test();
            expect.fail('Should have thrown');
        } catch (error) {
            // tRPC wraps unknown errors as INTERNAL_SERVER_ERROR
            expect(error).toBeInstanceOf(TRPCError);
            expect((error as TRPCError).code).toBe('INTERNAL_SERVER_ERROR');
        }
    });

    it('passes through successful results', async () => {
        const router = t.router({
            test: baseProcedure.query(() => {
                return { success: true, data: 'test' };
            }),
        });

        const caller = router.createCaller({});

        const result = await caller.test();

        expect(result).toEqual({ success: true, data: 'test' });
    });
});

describe('domainErrorFormatter', () => {
    function makeShape(
        overrides: Partial<TRPCDefaultErrorShape> = {}
    ): TRPCDefaultErrorShape {
        return {
            code: -32000,
            message: 'test',
            data: {
                code: 'INTERNAL_SERVER_ERROR',
                httpStatus: 500,
                path: 'test',
            },
            ...overrides,
        } as TRPCDefaultErrorShape;
    }

    it('adds domainCode when error.cause is a DomainError', () => {
        const cause = new TrialExpiredError();
        const error = new TRPCError({
            code: 'FORBIDDEN',
            message: cause.message,
            cause,
        });

        const shaped = domainErrorFormatter({ shape: makeShape(), error });

        expect(shaped.data.domainCode).toBe('TRIAL_EXPIRED');
    });

    it('preserves all original shape fields', () => {
        const cause = new NotFoundError('File', 'abc');
        const error = new TRPCError({
            code: 'NOT_FOUND',
            message: cause.message,
            cause,
        });
        const shape = makeShape({
            data: {
                code: 'NOT_FOUND',
                httpStatus: 404,
                path: 'files.get',
            } as TRPCDefaultErrorShape['data'],
        });

        const shaped = domainErrorFormatter({ shape, error });

        expect(shaped.code).toBe(shape.code);
        expect(shaped.message).toBe(shape.message);
        expect(shaped.data.code).toBe('NOT_FOUND');
        expect(shaped.data.httpStatus).toBe(404);
        expect(shaped.data.path).toBe('files.get');
        expect(shaped.data.domainCode).toBe('NOT_FOUND');
    });

    it('omits domainCode for non-DomainError causes (bare TRPCError)', () => {
        const error = new TRPCError({ code: 'UNAUTHORIZED' });

        const shaped = domainErrorFormatter({ shape: makeShape(), error });

        expect(shaped.data.domainCode).toBeUndefined();
    });

    it('omits domainCode for generic Error causes', () => {
        const error = new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            cause: new Error('boom'),
        });

        const shaped = domainErrorFormatter({ shape: makeShape(), error });

        expect(shaped.data.domainCode).toBeUndefined();
    });

    it('distinguishes TrialExpiredError from generic ForbiddenError (same tRPC code)', () => {
        const forbidden = new TRPCError({
            code: 'FORBIDDEN',
            cause: new ForbiddenError(),
        });
        const trialExpired = new TRPCError({
            code: 'FORBIDDEN',
            cause: new TrialExpiredError(),
        });

        const a = domainErrorFormatter({
            shape: makeShape(),
            error: forbidden,
        });
        const b = domainErrorFormatter({
            shape: makeShape(),
            error: trialExpired,
        });

        expect(a.data.domainCode).toBe('FORBIDDEN');
        expect(b.data.domainCode).toBe('TRIAL_EXPIRED');
    });
});

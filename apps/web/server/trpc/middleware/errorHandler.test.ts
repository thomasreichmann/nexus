import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    const { createMockSentry } = await import('@/lib/sentry/testing');
    return { logger: createMockLogger(), sentry: createMockSentry() };
});

// The procedures under test are init.ts's own, so the middleware is the one
// production runs, wired where production wires it. Stubbed: the DB pool and
// auth server init.ts imports (neither is reached by these procedures), and
// the logging middleware's sinks.
vi.mock('@/server/db', () => ({ db: {} }));
vi.mock('@/lib/auth/server', () => ({ auth: {} }));
vi.mock('@sentry/nextjs', () => hoisted.sentry);
vi.mock('@/server/lib/logger', () => ({
    errorVerbosity: 'minimal',
    isDev: false,
    logger: hoisted.logger,
}));

import {
    NotFoundError,
    ForbiddenError,
    InvalidStateError,
    QuotaExceededError,
    TrialExpiredError,
    type DomainError,
} from '@/server/errors';
import { domainErrorFormatter } from '../error-formatter';
import { buildContext, publicProcedure, router } from '../init';
import type { Connection } from '@nexus/db';
import type { TRPCDefaultErrorShape } from '@trpc/server';

/** Call a public procedure whose resolver does `resolve`, the way a client would. */
function callPublicProcedure<T>(resolve: () => T): Promise<T> {
    const caller = router({
        test: publicProcedure.query(resolve),
    }).createCaller(buildContext({ db: {} as Connection, session: null }));
    return caller.test();
}

/** What the procedure rejects with when its resolver throws `error`. */
function rejectionFor(error: Error): Promise<unknown> {
    return callPublicProcedure(() => {
        throw error;
    }).catch((rejection: unknown) => rejection);
}

describe('errorHandlerMiddleware', () => {
    it.each<[string, DomainError, TRPCError['code']]>([
        ['NotFoundError', new NotFoundError('File', 'abc-123'), 'NOT_FOUND'],
        [
            'ForbiddenError',
            new ForbiddenError('Cannot access this resource'),
            'FORBIDDEN',
        ],
        [
            'InvalidStateError',
            new InvalidStateError('Retrieval already in progress'),
            'BAD_REQUEST',
        ],
        [
            'QuotaExceededError',
            new QuotaExceededError({
                usedBytes: 100,
                limitBytes: 50,
                requestedBytes: 10,
            }),
            'PRECONDITION_FAILED',
        ],
        ['TrialExpiredError', new TrialExpiredError(), 'FORBIDDEN'],
    ])(
        'maps %s to its TRPCError code and message',
        async (_name, error, code) => {
            const rejection = await rejectionFor(error);

            expect(rejection).toBeInstanceOf(TRPCError);
            expect(rejection).toMatchObject({ code, message: error.message });
        }
    );

    it('keeps the original DomainError as the cause', async () => {
        const error = new NotFoundError('File', 'abc-123');

        const rejection = await rejectionFor(error);

        expect((rejection as TRPCError).cause).toBe(error);
    });

    it('leaves a non-domain error as INTERNAL_SERVER_ERROR', async () => {
        const rejection = await rejectionFor(new Error('Something went wrong'));

        expect(rejection).toBeInstanceOf(TRPCError);
        expect(rejection).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    });

    it('passes a successful result through', async () => {
        await expect(
            callPublicProcedure(() => ({ success: true, data: 'test' }))
        ).resolves.toEqual({ success: true, data: 'test' });
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

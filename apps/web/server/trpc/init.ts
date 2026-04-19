import { auth } from '@/lib/auth/server';
import { lazyAsync } from '@/lib/async/lazy';
import { db } from '@/server/db';
import type { Connection } from '@nexus/db';
import { isDomainError } from '@/server/errors';
import { createSubscriptionRepo } from '@nexus/db/repo/subscriptions';
import { initTRPC, TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import superjson from 'superjson';
import { domainErrorFormatter } from './error-formatter';
import { logRequest, type LoggingContext } from './middleware/logging';

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Pure context builder — assembles the tRPC ctx from its inputs. Kept
 * separate from `createTRPCContext` so tests can build an equivalent ctx
 * without running the Next-specific session fetch. New ctx fields added
 * here flow into both production and test callers automatically.
 */
export function buildContext(deps: { db: Connection; session: Session }) {
    return {
        ...deps,
        // Request-scoped: one DB fetch per HTTP request, shared across every
        // procedure in a tRPC batch. Returns undefined for unauthenticated
        // callers; protected services receive it as-is.
        getSubscription: lazyAsync(() =>
            deps.session
                ? createSubscriptionRepo(deps.db).findByUserId(
                      deps.session.user.id
                  )
                : Promise.resolve(undefined)
        ),
    };
}

export async function createTRPCContext() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });
    return buildContext({ db, session });
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

// Extended context with logging - available in all procedures
export type LoggedContext = Context & LoggingContext;

const t = initTRPC.context<Context>().create({
    transformer: superjson,
    errorFormatter: domainErrorFormatter,
});

export const router = t.router;

// Logging middleware - applied to all procedures
const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
    const { requestId, log, emitEvent } = logRequest({ ctx, path, type });

    const result = await next({
        ctx: {
            ...ctx,
            requestId,
            log,
        },
    });

    if (result.ok) {
        emitEvent(true);
    } else {
        emitEvent(false, result.error);
    }

    return result;
});

// Error handler middleware - catches DomainError and converts to TRPCError
// In tRPC v11, errors thrown in procedures are wrapped in result objects (not thrown).
// The original error is available via result.error.cause, not try/catch.
const errorHandlerMiddleware = t.middleware(async ({ next }) => {
    const result = await next();

    if (!result.ok) {
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

// Base procedure with logging and error handling
const baseProcedure = t.procedure
    .use(loggingMiddleware)
    .use(errorHandlerMiddleware);

// Public procedure - anyone can call, session may be null
export const publicProcedure = baseProcedure;

// Protected procedure - throws UNAUTHORIZED if not authenticated
export const protectedProcedure = baseProcedure.use(({ ctx, next }) => {
    if (!ctx.session) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    return next({
        ctx: {
            ...ctx,
            session: ctx.session,
        },
    });
});

// Admin procedure - throws FORBIDDEN if user is not an admin
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.session.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN' });
    }

    return next({ ctx });
});

// Dev tools procedure - admin-only and blocked in production
export const devToolsProcedure = adminProcedure.use(({ next }) => {
    if (process.env.NODE_ENV === 'production') {
        throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Dev tools are not available in production',
        });
    }

    return next();
});

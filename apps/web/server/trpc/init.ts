import { auth } from '@/lib/auth/server';
import { db } from '@/server/db';
import { initTRPC, TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import superjson from 'superjson';
import { logRequest, type LoggingContext } from './middleware/logging';

export async function createTRPCContext() {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return {
        db,
        session,
    };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

// Extended context with logging - available in all procedures
export type LoggedContext = Context & LoggingContext;

const t = initTRPC.context<Context>().create({
    transformer: superjson,
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
        emitEvent(false, result.error.code);
    }

    return result;
});

// Base procedure with logging
const loggedProcedure = t.procedure.use(loggingMiddleware);

// Public procedure - anyone can call, session may be null
export const publicProcedure = loggedProcedure;

// Protected procedure - throws UNAUTHORIZED if not authenticated
export const protectedProcedure = loggedProcedure.use(({ ctx, next }) => {
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

import { auth } from '@/lib/auth/server';
import { db } from '@/server/db';
import { initTRPC, TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import superjson from 'superjson';

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

const t = initTRPC.context<Context>().create({
    transformer: superjson,
});

export const router = t.router;

// Public procedure - anyone can call, session may be null
export const publicProcedure = t.procedure;

// Protected procedure - throws UNAUTHORIZED if not authenticated
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
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

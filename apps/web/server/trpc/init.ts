import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { db } from '@/server/db';

export function createTRPCContext() {
    return { db };
}

export type Context = ReturnType<typeof createTRPCContext>;

const t = initTRPC.context<Context>().create({
    transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

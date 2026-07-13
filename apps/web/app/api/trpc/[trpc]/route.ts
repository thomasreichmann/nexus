import * as Sentry from '@sentry/nextjs';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { createTRPCContext } from '@/server/trpc/init';
import { appRouter } from '@/server/trpc/router';

function handler(req: Request) {
    return fetchRequestHandler({
        endpoint: '/api/trpc',
        req,
        router: appRouter,
        createContext: createTRPCContext,
        // Procedure errors are reported by the logging middleware. A missing
        // ctx means createTRPCContext itself threw (session store or DB
        // outage) — the one class of error no middleware ever runs for, and
        // the adapter swallows it before Next's onRequestError can see it.
        onError({ error, ctx }) {
            if (ctx === undefined) {
                Sentry.captureException(error.cause ?? error, {
                    tags: { source: 'createTRPCContext' },
                });
            }
        },
    });
}

export { handler as GET, handler as POST };

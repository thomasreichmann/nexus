import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { createTRPCContext } from '@/server/trpc/init';
import { appRouter } from '@/server/trpc/router';

function handler(req: Request) {
    return fetchRequestHandler({
        endpoint: '/api/trpc',
        req,
        router: appRouter,
        createContext: createTRPCContext,
    });
}

export { handler as GET, handler as POST };

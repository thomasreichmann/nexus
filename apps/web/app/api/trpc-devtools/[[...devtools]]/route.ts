import { createTRPCDevtools } from 'trpc-devtools/server';
import { appRouter } from '@/server/trpc/router';

const handler = createTRPCDevtools({
    router: appRouter,
    url: '/api/trpc',
});

export { handler as GET, handler as POST };

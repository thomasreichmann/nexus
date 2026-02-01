import { createTRPCStudio } from '@nexus/trpc-studio/server';
import { appRouter } from '@/server/trpc/router';

const handler = createTRPCStudio({
    router: appRouter,
    url: '/api/trpc',
});

export { handler as GET, handler as POST };

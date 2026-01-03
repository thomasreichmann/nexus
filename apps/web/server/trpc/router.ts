import { router } from './init';
import { authRouter } from './routers/auth';
import { debugRouter } from './routers/debug';

export const appRouter = router({
    auth: authRouter,
    debug: debugRouter,
});

export type AppRouter = typeof appRouter;

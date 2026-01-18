import { router } from './init';
import { authRouter } from './routers/auth';
import { dashboardRouter } from './routers/dashboard';
import { debugRouter } from './routers/debug';

export const appRouter = router({
    auth: authRouter,
    dashboard: dashboardRouter,
    debug: debugRouter,
});

export type AppRouter = typeof appRouter;

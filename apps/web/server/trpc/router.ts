import { router } from './init';
import { adminRouter } from './routers/admin';
import { authRouter } from './routers/auth';
import { dashboardRouter } from './routers/dashboard';
import { debugRouter } from './routers/debug';
import { filesRouter } from './routers/files';
import { retrievalsRouter } from './routers/retrievals';

export const appRouter = router({
    admin: adminRouter,
    auth: authRouter,
    dashboard: dashboardRouter,
    debug: debugRouter,
    files: filesRouter,
    retrievals: retrievalsRouter,
});

export type AppRouter = typeof appRouter;

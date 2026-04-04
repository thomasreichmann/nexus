import { router } from './init';
import { adminRouter } from './routers/admin';
import { authRouter } from './routers/auth';
import { debugRouter } from './routers/debug';
import { filesRouter } from './routers/files';
import { retrievalsRouter } from './routers/retrievals';
import { storageRouter } from './routers/storage';
import { subscriptionsRouter } from './routers/subscriptions';

export const appRouter = router({
    admin: adminRouter,
    auth: authRouter,
    debug: debugRouter,
    files: filesRouter,
    retrievals: retrievalsRouter,
    storage: storageRouter,
    subscriptions: subscriptionsRouter,
});

export type AppRouter = typeof appRouter;

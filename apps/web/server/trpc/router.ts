import { router } from './init';
import { debugRouter } from './routers/debug';
import { usersRouter } from './routers/users';

export const appRouter = router({
    debug: debugRouter,
    users: usersRouter,
});

export type AppRouter = typeof appRouter;

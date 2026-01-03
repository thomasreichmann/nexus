import { protectedProcedure, publicProcedure, router } from '../init';

export const debugRouter = router({
    random: publicProcedure.query(() => {
        return {
            now: Date.now(),
            random: Math.random(),
        };
    }),
    user: protectedProcedure.query(({ ctx }) => {
        return ctx.session.user;
    }),
});

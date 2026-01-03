import { publicProcedure, router } from '../init';

export const authRouter = router({
    // Returns current user or null (from tRPC context)
    me: publicProcedure.query(({ ctx }) => {
        return ctx.session?.user ?? null;
    }),
});

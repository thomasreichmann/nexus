import { findByUser } from '@nexus/db/repo/retrievals';
import { protectedProcedure, router } from '../init';

export const retrievalsRouter = router({
    list: protectedProcedure.query(({ ctx }) => {
        return findByUser(ctx.db, ctx.session.user.id);
    }),
});

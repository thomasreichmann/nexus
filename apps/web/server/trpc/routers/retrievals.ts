import * as retrievalRepo from '@nexus/db';
import { protectedProcedure, router } from '../init';

export const retrievalsRouter = router({
    list: protectedProcedure.query(({ ctx }) => {
        return retrievalRepo.findByUser(ctx.db, ctx.session.user.id);
    }),
});

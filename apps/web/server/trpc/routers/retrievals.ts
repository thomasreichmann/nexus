import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { protectedProcedure, router } from '../init';

export const retrievalsRouter = router({
    list: protectedProcedure.query(({ ctx }) => {
        const retrievalRepo = createRetrievalRepo(ctx.db);
        return retrievalRepo.findByUser(ctx.session.user.id);
    }),
});

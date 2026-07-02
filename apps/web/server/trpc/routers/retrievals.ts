import { z } from 'zod';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { retrievalService } from '@/server/services/retrieval';
import { protectedProcedure, router } from '../init';

export const retrievalsRouter = router({
    list: protectedProcedure.query(({ ctx }) => {
        const retrievalRepo = createRetrievalRepo(ctx.db);
        return retrievalRepo.findByUser(ctx.session.user.id);
    }),

    listActive: protectedProcedure.query(({ ctx }) => {
        const retrievalRepo = createRetrievalRepo(ctx.db);
        return retrievalRepo.findActiveByUserWithFiles(ctx.session.user.id);
    }),

    batchStatus: protectedProcedure
        .input(z.object({ batchId: z.string().uuid() }))
        .query(({ ctx, input }) =>
            retrievalService.getBatchRetrievalStatus(
                ctx.db,
                ctx.session.user.id,
                input.batchId
            )
        ),
});

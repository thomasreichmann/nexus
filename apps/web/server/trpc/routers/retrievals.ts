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

    requestStatus: protectedProcedure
        .input(z.object({ requestId: z.string().uuid() }))
        .query(({ ctx, input }) =>
            retrievalService.getRequestStatus(
                ctx.db,
                ctx.session.user.id,
                input.requestId
            )
        ),

    /**
     * Restores with a downloadable zip behind them (#426). Separate from
     * `listActive`, which reads the retrieval rows — those lapse after
     * `ZIP_BUILD_RESTORE_DAYS` while the artifacts live five days longer.
     */
    listReady: protectedProcedure.query(({ ctx }) =>
        retrievalService.listReadyRequests(ctx.db, ctx.session.user.id)
    ),

    /** One request's delivery state and parts, for the `?request=` panel. */
    requestDelivery: protectedProcedure
        .input(z.object({ requestId: z.string().uuid() }))
        .query(({ ctx, input }) =>
            retrievalService.getRequestDelivery(
                ctx.db,
                ctx.session.user.id,
                input.requestId
            )
        ),

    artifactDownloadUrl: protectedProcedure
        .input(z.object({ artifactId: z.string().uuid() }))
        .query(({ ctx, input }) =>
            retrievalService.getArtifactDownloadUrl(
                ctx.db,
                ctx.session.user.id,
                input.artifactId
            )
        ),
});

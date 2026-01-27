import { z } from 'zod';
import { NotFoundError } from '@/server/errors';
import { fileService } from '@/server/services/files';
import { protectedProcedure, router } from '../init';

export const filesRouter = router({
    upload: protectedProcedure
        .input(
            z.object({
                name: z.string().min(1).max(255),
                sizeBytes: z.number().positive(),
                mimeType: z.string().optional(),
            })
        )
        .mutation(({ ctx, input }) => {
            return fileService.initiateUpload(
                ctx.db,
                ctx.session.user.id,
                input
            );
        }),

    confirmUpload: protectedProcedure
        .input(z.object({ fileId: z.string().uuid() }))
        .mutation(({ ctx, input }) => {
            return fileService.confirmUpload(
                ctx.db,
                ctx.session.user.id,
                input.fileId
            );
        }),

    delete: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ input }) => {
            // Simulated not-found for demonstrating error handling
            const hasFile = false;

            if (!hasFile) {
                throw new NotFoundError('File', input.id);
            }

            return { success: true };
        }),
});

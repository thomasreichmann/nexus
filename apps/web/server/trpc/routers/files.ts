import { z } from 'zod';
import * as fileRepo from '@/server/db/repositories/files';
import { fileService } from '@/server/services/files';
import { protectedProcedure, router } from '../init';

export const filesRouter = router({
    list: protectedProcedure
        .input(
            z
                .object({
                    limit: z.number().min(1).max(100).default(50),
                    offset: z.number().min(0).default(0),
                    includeHidden: z.boolean().default(false),
                })
                .optional()
        )
        .query(async ({ ctx, input }) => {
            const limit = input?.limit ?? 50;
            const offset = input?.offset ?? 0;
            const includeHidden = input?.includeHidden ?? false;

            const [files, total] = await Promise.all([
                fileRepo.findFilesByUser(ctx.db, ctx.session.user.id, {
                    limit,
                    offset,
                    includeHidden,
                }),
                fileRepo.countFilesByUser(ctx.db, ctx.session.user.id, {
                    includeHidden,
                }),
            ]);

            return {
                files,
                total,
                hasMore: offset + files.length < total,
            };
        }),

    get: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(({ ctx, input }) => {
            return fileRepo.findUserFile(ctx.db, ctx.session.user.id, input.id);
        }),

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
        .mutation(({ ctx, input }) => {
            return fileService.deleteUserFile(
                ctx.db,
                ctx.session.user.id,
                input.id
            );
        }),

    deleteMany: protectedProcedure
        .input(z.object({ ids: z.array(z.string().uuid()).max(100) }))
        .mutation(({ ctx, input }) => {
            return fileService.deleteUserFile(
                ctx.db,
                ctx.session.user.id,
                input.ids
            );
        }),
});

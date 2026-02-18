import { z } from 'zod';
import { RESTORE_TIERS } from '@nexus/db/schema';
import { createFileRepo } from '@nexus/db/repo/files';
import { fileService } from '@/server/services/files';
import { retrievalService } from '@/server/services/retrieval';
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
            const fileRepo = createFileRepo(ctx.db);
            const limit = input?.limit ?? 50;
            const offset = input?.offset ?? 0;
            const includeHidden = input?.includeHidden ?? false;

            const [files, total] = await Promise.all([
                fileRepo.findByUser(ctx.session.user.id, {
                    limit,
                    offset,
                    includeHidden,
                }),
                fileRepo.countByUser(ctx.session.user.id, {
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
            const fileRepo = createFileRepo(ctx.db);
            return fileRepo.findByUserAndId(ctx.session.user.id, input.id);
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

    requestRetrieval: protectedProcedure
        .input(
            z.object({
                fileId: z.string().uuid(),
                tier: z.enum(RESTORE_TIERS).default('standard'),
            })
        )
        .mutation(({ ctx, input }) => {
            return retrievalService.requestRetrieval(
                ctx.db,
                ctx.session.user.id,
                input.fileId,
                input.tier
            );
        }),

    requestBulkRetrieval: protectedProcedure
        .input(
            z.object({
                fileIds: z.array(z.string().uuid()).min(1).max(100),
                tier: z.enum(RESTORE_TIERS).default('standard'),
            })
        )
        .mutation(({ ctx, input }) => {
            return retrievalService.requestBulkRetrieval(
                ctx.db,
                ctx.session.user.id,
                input.fileIds,
                input.tier
            );
        }),

    getDownloadUrl: protectedProcedure
        .input(z.object({ fileId: z.string().uuid() }))
        .query(({ ctx, input }) => {
            return retrievalService.getDownloadUrl(
                ctx.db,
                ctx.session.user.id,
                input.fileId
            );
        }),
});

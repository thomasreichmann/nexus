import { z } from 'zod';
import { RESTORE_TIERS } from '@nexus/db/schema';
import { createFileRepo } from '@nexus/db/repo/files';
import { fileService } from '@/server/services/files';
import { retrievalService } from '@/server/services/retrieval';
import { protectedProcedure, router } from '../init';

const uploadInputSchema = z.object({
    name: z.string().min(1).max(255),
    sizeBytes: z.number().positive(),
    mimeType: z.string().optional(),
});

export const filesRouter = router({
    list: protectedProcedure
        .input(
            z
                .object({
                    limit: z.number().min(1).max(100).default(50),
                    offset: z.number().min(0).default(0),
                    includeHidden: z.boolean().default(false),
                    search: z.string().trim().optional(),
                    sortKey: z
                        .enum(['name', 'size', 'uploadedAt'])
                        .default('uploadedAt'),
                    sortOrder: z.enum(['asc', 'desc']).default('desc'),
                })
                .prefault({})
        )
        .query(async ({ ctx, input }) => {
            const fileRepo = createFileRepo(ctx.db);
            const { limit, offset, includeHidden, search, sortKey, sortOrder } =
                input;
            const userId = ctx.session.user.id;

            const [files, total, counts] = await Promise.all([
                fileRepo.findByUser(userId, {
                    limit,
                    offset,
                    includeHidden,
                    search,
                    sortKey,
                    sortOrder,
                }),
                fileRepo.countByUser(userId, { includeHidden, search }),
                fileRepo.countStatusesByUser(userId, { includeHidden }),
            ]);

            return {
                files,
                total,
                hasMore: offset + files.length < total,
                counts,
            };
        }),

    get: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(({ ctx, input }) => {
            const fileRepo = createFileRepo(ctx.db);
            return fileRepo.findByUserAndId(ctx.session.user.id, input.id);
        }),

    upload: protectedProcedure
        .input(uploadInputSchema)
        .mutation(async ({ ctx, input }) => {
            return fileService.initiateUpload(
                ctx.db,
                ctx.session.user.id,
                input,
                await ctx.getSubscription()
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

    multipart: router({
        init: protectedProcedure
            .input(uploadInputSchema)
            .mutation(async ({ ctx, input }) => {
                return fileService.initiateMultipartUpload(
                    ctx.db,
                    ctx.session.user.id,
                    input,
                    await ctx.getSubscription()
                );
            }),

        complete: protectedProcedure
            .input(
                z.object({
                    fileId: z.string().uuid(),
                    uploadId: z.string().min(1),
                    parts: z
                        .array(
                            z.object({
                                partNumber: z.number().int().positive(),
                                etag: z.string().min(1),
                            })
                        )
                        .min(1)
                        .max(10000),
                })
            )
            .mutation(({ ctx, input }) => {
                return fileService.completeMultipartUpload(
                    ctx.db,
                    ctx.session.user.id,
                    input
                );
            }),

        abort: protectedProcedure
            .input(
                z.object({
                    fileId: z.string().uuid(),
                    uploadId: z.string().min(1),
                })
            )
            .mutation(({ ctx, input }) => {
                return fileService.abortMultipartUpload(
                    ctx.db,
                    ctx.session.user.id,
                    input.fileId,
                    input.uploadId
                );
            }),
    }),
});

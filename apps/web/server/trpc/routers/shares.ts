import { z } from 'zod';
import { MAX_SHARE_BYTES, MAX_SHARE_FILES } from '@/lib/share/limits';
import { shareService } from '@/server/services/shares';
import { publicProcedure, router } from '../init';

const shareId = z.string().min(1).max(64);

/**
 * Public 24-hour share links. Every procedure is public: creating a link takes
 * no account, and the link itself is the only credential for reading one.
 */
export const sharesRouter = router({
    create: publicProcedure
        .input(
            z.object({
                files: z
                    .array(
                        z.object({
                            name: z.string().min(1).max(255),
                            size: z.number().int().min(0).max(MAX_SHARE_BYTES),
                        })
                    )
                    .min(1)
                    .max(MAX_SHARE_FILES),
            })
        )
        .mutation(({ ctx, input }) =>
            shareService.createShare(ctx.db, {
                files: input.files,
                clientIp: ctx.clientIp,
            })
        ),

    complete: publicProcedure
        .input(z.object({ id: shareId }))
        .mutation(({ ctx, input }) =>
            shareService.completeShare(ctx.db, input.id)
        ),

    // A mutation, not a query like `files.getDownloadUrl`: each call counts
    // against the file's download limit, and a GET can be replayed or
    // prefetched by anything that sees the URL.
    getDownloadUrl: publicProcedure
        .input(z.object({ shareId, fileId: z.string().uuid() }))
        .mutation(({ ctx, input }) =>
            shareService.getDownloadUrl(ctx.db, input)
        ),
});

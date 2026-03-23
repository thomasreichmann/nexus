import { eq } from 'drizzle-orm';
import { subscriptions } from '@nexus/db/schema';
import { createFileRepo } from '@nexus/db/repo/files';
import { protectedProcedure, router } from '../init';

const DEFAULT_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB

export const storageRouter = router({
    getUsage: protectedProcedure.query(async ({ ctx }) => {
        const fileRepo = createFileRepo(ctx.db);
        const userId = ctx.session.user.id;

        const [usedBytes, fileCount, sub] = await Promise.all([
            fileRepo.sumStorageByUser(userId),
            fileRepo.countByUser(userId),
            ctx.db.query.subscriptions.findFirst({
                where: eq(subscriptions.userId, userId),
                columns: { storageLimit: true, planTier: true },
            }),
        ]);

        const quotaBytes = sub?.storageLimit ?? DEFAULT_STORAGE_LIMIT;
        const percentage = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

        return {
            usedBytes,
            quotaBytes,
            percentage: Math.min(percentage, 100),
            fileCount,
            planTier: sub?.planTier ?? 'starter',
        };
    }),

    getByType: protectedProcedure.query(async ({ ctx }) => {
        const fileRepo = createFileRepo(ctx.db);
        return fileRepo.sumStorageByMimeCategory(ctx.session.user.id);
    }),

    getUploadHistory: protectedProcedure.query(async ({ ctx }) => {
        const fileRepo = createFileRepo(ctx.db);
        return fileRepo.uploadHistoryByDay(ctx.session.user.id, 30);
    }),
});

import { storageService } from '@/server/services/storage';
import { protectedProcedure, router } from '../init';

export const storageRouter = router({
    getUsage: protectedProcedure.query(({ ctx }) => {
        return storageService.getUsage(ctx.db, ctx.session.user.id);
    }),

    getByType: protectedProcedure.query(({ ctx }) => {
        return storageService.getByType(ctx.db, ctx.session.user.id);
    }),

    getUploadHistory: protectedProcedure.query(({ ctx }) => {
        return storageService.getUploadHistory(ctx.db, ctx.session.user.id);
    }),
});

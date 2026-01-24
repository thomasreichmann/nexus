import { z } from 'zod';
import { NotFoundError } from '@/server/errors';
import { protectedProcedure, router } from '../init';

// Example router demonstrating domain error usage
export const filesRouter = router({
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

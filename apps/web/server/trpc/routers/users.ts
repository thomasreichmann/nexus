import { publicProcedure, router } from '../init';
import { users } from '@/server/db/schema';
import { sql } from 'drizzle-orm';

export const usersRouter = router({
    count: publicProcedure.query(async ({ ctx }) => {
        const [result] = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(users);
        return result.count;
    }),
});

import { z } from 'zod';
import { CHECKOUT_TIERS, BILLING_INTERVALS } from '@/lib/stripe/types';
import { subscriptionService } from '@/server/services/subscriptions';
import { protectedProcedure, router } from '../init';

export const subscriptionsRouter = router({
    current: protectedProcedure.query(({ ctx }) => {
        return subscriptionService.getCurrentSubscription(
            ctx.db,
            ctx.session.user.id
        );
    }),

    createCheckoutSession: protectedProcedure
        .input(
            z.object({
                tier: z.enum(CHECKOUT_TIERS),
                interval: z.enum(BILLING_INTERVALS),
            })
        )
        .mutation(({ ctx, input }) => {
            return subscriptionService.createCheckoutSession(
                ctx.db,
                ctx.session.user.id,
                input.tier,
                input.interval
            );
        }),

    createPortalSession: protectedProcedure.mutation(({ ctx }) => {
        return subscriptionService.createPortalSession(
            ctx.db,
            ctx.session.user.id
        );
    }),
});

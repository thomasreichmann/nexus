import { PLAN_LIMITS, type PlanTier } from '@nexus/db/plans';
import type { Subscription } from '@nexus/db/repo/subscriptions';

export { PLAN_LIMITS, type PlanTier };
export type { CheckoutTier, BillingInterval } from '@/lib/stripe/types';

/** Trial duration in days. */
export const TRIAL_DURATION_DAYS = 30;

/**
 * Resolves the effective plan (limit + tier) for a user, falling back to
 * starter when no subscription exists. Centralizes the starter-default so
 * callers don't duplicate the null-coalesce across services.
 */
export function resolvePlan(sub: Subscription | undefined): {
    quotaBytes: number;
    planTier: PlanTier;
} {
    return {
        quotaBytes: sub?.storageLimit ?? PLAN_LIMITS.starter,
        planTier: sub?.planTier ?? 'starter',
    };
}

import { PLAN_LIMITS, type PlanTier } from '@nexus/db/plans';
import type { Subscription } from '@nexus/db/repo/subscriptions';

export { PLAN_LIMITS, type PlanTier };
export type { CheckoutTier, BillingInterval } from '@/lib/stripe/types';

/** Trial duration in days. */
export const TRIAL_DURATION_DAYS = 30;

/**
 * Default storage cap for sponsored (comped alpha-tester) subscriptions.
 * An invite may carry a per-tester `storageLimit` override; this is the
 * fallback when it doesn't.
 */
export const SPONSORED_DEFAULT_STORAGE_LIMIT = PLAN_LIMITS.max;

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

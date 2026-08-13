import type { planTierEnum } from './schema/subscriptions';

export type PlanTier = (typeof planTierEnum.enumValues)[number];

/** Storage limits by plan tier in bytes. */
export const PLAN_LIMITS: Record<PlanTier, number> = {
    starter: 1024 ** 4, //      1 TB
    pro: 5 * 1024 ** 4, //      5 TB
    max: 10 * 1024 ** 4, //    10 TB
    enterprise: 100 * 1024 ** 4, // 100 TB (custom; "20TB+" marketed)
};

/**
 * Lives here rather than in `apps/web` so seeds and test-db helpers can reach
 * it — they can't import from the app.
 */
export const TRIAL_DURATION_DAYS = 30;

/**
 * Trial expiry for a subscription starting at `from`. Fixed 24-hour days; the
 * signup path uses date-fns `addDays`, which is calendar-aware, so the two can
 * differ by an hour across a DST boundary. That's fine for seeds and fixtures,
 * and `packages/db` has no date-fns dependency to share the calendar version.
 */
export function getTrialEnd(from: Date = new Date()): Date {
    return new Date(from.getTime() + TRIAL_DURATION_DAYS * 86_400_000);
}

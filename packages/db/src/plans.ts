import type { Subscription } from './repositories/subscriptions';
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
 * Optimistic concurrency: upload pre-checks pass at 100% of the plan limit, but
 * we accept up to 105% so a burst of concurrent uploads — each individually
 * passing the check before any of them has written — can land without
 * rejection. The 5% band also covers small drift between `storage_usage` and
 * reality. Enforced in `apps/web/server/services/quota.ts`; it lives here so
 * the specs that park a user at the cap don't each carry their own copy.
 */
export const SOFT_LIMIT_MULTIPLIER = 1.05;

/**
 * The byte ceiling `checkQuota` actually enforces for a plan limit. A
 * function rather than "multiply it yourself" so the client-side pre-flight
 * (`apps/web/lib/upload/preflight.ts`) can't drift from the server on the
 * rounding step.
 */
export function softCapBytes(limitBytes: number): number {
    return Math.floor(limitBytes * SOFT_LIMIT_MULTIPLIER);
}

/**
 * Projected usage above this fraction of the plan limit counts as "near the
 * limit" — the server's `checkQuota` computes it and the upload page's
 * pre-flight warning mirrors it client-side, so the two must share one
 * number (same reasoning as `SOFT_LIMIT_MULTIPLIER` above).
 */
export const NEAR_LIMIT_RATIO = 0.9;

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

/**
 * Whether a subscription's trial has run out. Only `trialing` rows can expire:
 * every other status — including `sponsored` (comped alpha testers, no Stripe
 * subscription, so no `trialEnd`) — is enforced on `storageLimit` alone.
 *
 * The bound is strict, so a trial is live right up to `trialEnd` and over the
 * instant after. Lives beside `getTrialEnd` so the two ends of the trial
 * window can't drift apart (#364).
 */
export function isTrialExpired(
    subscription: Pick<Subscription, 'status' | 'trialEnd'>,
    now: Date = new Date()
): boolean {
    return (
        subscription.status === 'trialing' &&
        subscription.trialEnd !== null &&
        subscription.trialEnd < now
    );
}

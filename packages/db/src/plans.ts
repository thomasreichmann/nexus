import type { planTierEnum } from './schema/subscriptions';

export type PlanTier = (typeof planTierEnum.enumValues)[number];

/** Storage limits by plan tier in bytes. */
export const PLAN_LIMITS: Record<PlanTier, number> = {
    starter: 1024 ** 4, //      1 TB
    pro: 5 * 1024 ** 4, //      5 TB
    max: 10 * 1024 ** 4, //    10 TB
    enterprise: 100 * 1024 ** 4, // 100 TB (custom; "20TB+" marketed)
};

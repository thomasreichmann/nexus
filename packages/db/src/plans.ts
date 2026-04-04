import type { planTierEnum } from './schema/subscriptions';

export type PlanTier = (typeof planTierEnum.enumValues)[number];

/** Storage limits by plan tier in bytes. */
export const PLAN_LIMITS: Record<PlanTier, number> = {
    starter: 10 * 1024 ** 3, //    10 GB
    pro: 100 * 1024 ** 3, //   100 GB
    max: 1024 * 1024 ** 3, // 1,024 GB (1 TB)
    enterprise: 10 * 1024 ** 4, //  10 TB
};

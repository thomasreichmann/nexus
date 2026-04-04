import type { PlanTier } from '@nexus/db/plans';

export { PLAN_LIMITS, type PlanTier } from '@nexus/db/plans';

/** Default storage quota (10 GB) applied when no subscription overrides it. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** Trial duration in days. */
export const TRIAL_DURATION_DAYS = 30;

/** Tiers available for user-facing checkout (excludes enterprise). */
export type CheckoutTier = Exclude<PlanTier, 'enterprise'>;

export type BillingInterval = 'month' | 'year';

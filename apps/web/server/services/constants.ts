export { PLAN_LIMITS, type PlanTier } from '@nexus/db/plans';
export type { CheckoutTier, BillingInterval } from '@/lib/stripe/types';

/** Default storage quota (10 GB) applied when no subscription overrides it. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** Trial duration in days. */
export const TRIAL_DURATION_DAYS = 30;

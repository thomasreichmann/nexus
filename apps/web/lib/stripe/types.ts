import type { PlanTier } from '@nexus/db/plans';

/** Tiers available for user-facing checkout (excludes enterprise). */
export type CheckoutTier = Exclude<PlanTier, 'enterprise'>;

export type BillingInterval = 'month' | 'year';

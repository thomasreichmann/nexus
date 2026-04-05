import type { PlanTier } from '@nexus/db/plans';

export const CHECKOUT_TIERS = ['starter', 'pro', 'max'] as const;
export const BILLING_INTERVALS = ['month', 'year'] as const;

/** Tiers available for user-facing checkout (excludes enterprise). */
export type CheckoutTier = Exclude<PlanTier, 'enterprise'>;

export type BillingInterval = (typeof BILLING_INTERVALS)[number];

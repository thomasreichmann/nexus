import { planTierEnum } from '@nexus/db/schema';
import type { PlanTier } from '@nexus/db/plans';

/** Tiers available for user-facing checkout (excludes enterprise). */
export type CheckoutTier = Exclude<PlanTier, 'enterprise'>;

export const BILLING_INTERVALS = ['month', 'year'] as const;

export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// Derived from planTierEnum so adding a tier to the DB schema flows through
// to checkout validation automatically. Sales-driven enterprise is excluded.
export const CHECKOUT_TIERS = planTierEnum.enumValues.filter(
    (t): t is CheckoutTier => t !== 'enterprise'
);

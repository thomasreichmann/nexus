import { planTierEnum } from '@nexus/db/schema';
import type { PlanTier } from '@nexus/db/plans';

export const BILLING_INTERVALS = ['month', 'year'] as const;

export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// Single source of truth for which tiers are sales-only and excluded from
// self-serve checkout. Both the runtime list and the type derive from this.
const NON_CHECKOUT_TIERS = ['enterprise'] as const;
type NonCheckoutTier = (typeof NON_CHECKOUT_TIERS)[number];

/** Tiers available for user-facing checkout (excludes sales-driven tiers). */
export type CheckoutTier = Exclude<PlanTier, NonCheckoutTier>;

// Derived from planTierEnum so adding a tier to the DB schema flows through
// to checkout validation automatically.
export const CHECKOUT_TIERS = planTierEnum.enumValues.filter(
    (t): t is CheckoutTier =>
        !(NON_CHECKOUT_TIERS as readonly string[]).includes(t)
);

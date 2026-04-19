import type { VariantProps } from 'class-variance-authority';
import { PLAN_LIMITS, type PlanTier } from '@nexus/db/plans';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import { formatBytes } from '@/lib/format';
import type { CheckoutTier, BillingInterval } from '@/lib/stripe/types';
import type { badgeVariants } from '@/components/ui/badge';

export type { BillingInterval };

type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

export interface PlanDisplay {
    tier: CheckoutTier;
    name: string;
    storage: string;
    prices: Record<BillingInterval, number>;
}

/**
 * Display data for the three self-serve tiers. Monthly prices mirror the
 * landing page (`apps/web/components/landing/pricing.tsx`); annual gives two
 * months free (10× monthly), the standard SaaS discount. Storage strings
 * derive from `PLAN_LIMITS` so they can't drift from the DB enum + quota
 * enforcement. Enterprise is excluded because it's sales-only (see
 * `CHECKOUT_TIERS` in `lib/stripe/types`).
 */
export const PLAN_DISPLAY: readonly PlanDisplay[] = [
    {
        tier: 'starter',
        name: 'Starter',
        storage: formatBytes(PLAN_LIMITS.starter),
        prices: { month: 3, year: 30 },
    },
    {
        tier: 'pro',
        name: 'Pro',
        storage: formatBytes(PLAN_LIMITS.pro),
        prices: { month: 12, year: 120 },
    },
    {
        tier: 'max',
        name: 'Max',
        storage: formatBytes(PLAN_LIMITS.max),
        prices: { month: 20, year: 200 },
    },
] as const;

export type PlanComparison = 'current' | 'upgrade' | 'downgrade';

/** Lower `PLAN_LIMITS` = lower tier; avoids a second ordering table. */
export function comparePlans(
    currentTier: PlanTier,
    targetTier: PlanTier
): PlanComparison {
    if (currentTier === targetTier) return 'current';
    return PLAN_LIMITS[targetTier] > PLAN_LIMITS[currentTier]
        ? 'upgrade'
        : 'downgrade';
}

export interface StatusBadge {
    label: string;
    variant: BadgeVariant;
}

export function getStatusBadge(status: Subscription['status']): StatusBadge {
    switch (status) {
        case 'active':
            return { label: 'Active', variant: 'default' };
        case 'trialing':
            return { label: 'Trial', variant: 'secondary' };
        case 'past_due':
            return { label: 'Past due', variant: 'destructive' };
        case 'canceled':
            return { label: 'Canceled', variant: 'destructive' };
        case 'unpaid':
            return { label: 'Unpaid', variant: 'destructive' };
        case 'incomplete':
            return { label: 'Incomplete', variant: 'secondary' };
    }
}

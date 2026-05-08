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

// `Record<…enum…>` forces every enum value to have an entry — the runtime
// test in `subscriptionPlans.test.ts` is a belt-and-braces guard against
// adding a status without updating the map.
const STATUS_BADGES: Record<Subscription['status'], StatusBadge> = {
    active: { label: 'Active', variant: 'default' },
    trialing: { label: 'Trial', variant: 'secondary' },
    past_due: { label: 'Past due', variant: 'destructive' },
    canceled: { label: 'Canceled', variant: 'destructive' },
    unpaid: { label: 'Unpaid', variant: 'destructive' },
    incomplete: { label: 'Incomplete', variant: 'secondary' },
};

const UNKNOWN_STATUS_BADGE: StatusBadge = {
    label: 'Unknown',
    variant: 'secondary',
};

// Accepts `string` rather than the enum so a DB row whose status no longer
// matches the schema (migration drift, Stripe-emitted values like
// `incomplete_expired` / `paused`) renders a fallback badge instead of
// crashing the page.
export function getStatusBadge(status: string): StatusBadge {
    return (
        STATUS_BADGES[status as Subscription['status']] ?? UNKNOWN_STATUS_BADGE
    );
}

export interface PlanActionInput {
    comparison: PlanComparison;
    hasActiveSub: boolean;
    isPendingThisCheckout: boolean;
    isAnyCheckoutPending: boolean;
    isOpeningPortal: boolean;
}

export interface PlanActionDecision {
    label: 'Upgrade' | 'Downgrade';
    target: 'checkout' | 'portal';
    isPending: boolean;
    disabled: boolean;
}

/**
 * Routes paid users (any non-null `stripeSubscriptionId`) through the portal
 * for every tier change. Calling Stripe Checkout for a customer that already
 * has an active subscription creates a *second* subscription rather than
 * modifying the first — the portal is the only path that swaps the existing
 * subscription's price in place.
 *
 * Returns `null` for the current tier (no button rendered).
 */
export function decidePlanAction(
    input: PlanActionInput
): PlanActionDecision | null {
    if (input.comparison === 'current') return null;

    const isUpgrade = input.comparison === 'upgrade';
    const useCheckout = isUpgrade && !input.hasActiveSub;
    const isPending = useCheckout
        ? input.isPendingThisCheckout
        : input.isOpeningPortal;
    // Sibling-card lockout: while one checkout is firing, the others must
    // disable so a rapid double-click can't open two checkout sessions.
    const disabled = isPending || (useCheckout && input.isAnyCheckoutPending);

    return {
        label: isUpgrade ? 'Upgrade' : 'Downgrade',
        target: useCheckout ? 'checkout' : 'portal',
        isPending,
        disabled,
    };
}

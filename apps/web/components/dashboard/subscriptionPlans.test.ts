import { describe, expect, it } from 'vitest';
import { subscriptionStatusEnum } from '@nexus/db/schema';
import {
    PLAN_DISPLAY,
    comparePlans,
    decidePlanAction,
    getStatusBadge,
    type PlanActionInput,
} from './subscriptionPlans';

describe('comparePlans', () => {
    it('returns current for the same tier', () => {
        expect(comparePlans('pro', 'pro')).toBe('current');
    });

    it('returns upgrade for higher tiers', () => {
        expect(comparePlans('starter', 'pro')).toBe('upgrade');
        expect(comparePlans('starter', 'max')).toBe('upgrade');
        expect(comparePlans('pro', 'max')).toBe('upgrade');
    });

    it('returns downgrade for lower tiers', () => {
        expect(comparePlans('pro', 'starter')).toBe('downgrade');
        expect(comparePlans('max', 'pro')).toBe('downgrade');
        expect(comparePlans('enterprise', 'max')).toBe('downgrade');
    });
});

describe('getStatusBadge', () => {
    it('maps each status to a label + variant', () => {
        expect(getStatusBadge('active')).toEqual({
            label: 'Active',
            variant: 'default',
        });
        expect(getStatusBadge('trialing').variant).toBe('secondary');
        expect(getStatusBadge('past_due').variant).toBe('destructive');
        expect(getStatusBadge('canceled').variant).toBe('destructive');
        expect(getStatusBadge('unpaid').variant).toBe('destructive');
        expect(getStatusBadge('incomplete').variant).toBe('secondary');
    });

    // Guards against adding a new status to the DB enum without updating the
    // badge mapping — unmapped cases would fall through to undefined.
    it('returns a label for every subscription status enum value', () => {
        for (const status of subscriptionStatusEnum.enumValues) {
            const badge = getStatusBadge(status);
            expect(badge.label).toBeTruthy();
            expect(badge.variant).toBeTruthy();
        }
    });

    it('returns a fallback badge for runtime values not in the enum', () => {
        // Real Stripe-emitted statuses we don't list (yet); also covers
        // migration drift where a removed enum value lingers on existing rows.
        expect(getStatusBadge('incomplete_expired')).toEqual({
            label: 'Unknown',
            variant: 'secondary',
        });
        expect(getStatusBadge('paused')).toEqual({
            label: 'Unknown',
            variant: 'secondary',
        });
    });
});

describe('PLAN_DISPLAY', () => {
    it('covers all checkout tiers', () => {
        expect(PLAN_DISPLAY.map((p) => p.tier)).toEqual([
            'starter',
            'pro',
            'max',
        ]);
    });
});

describe('decidePlanAction', () => {
    const base: PlanActionInput = {
        comparison: 'upgrade',
        hasActiveSub: false,
        isPendingThisCheckout: false,
        isAnyCheckoutPending: false,
        isOpeningPortal: false,
    };

    it('returns null for the active tier (no button rendered)', () => {
        expect(decidePlanAction({ ...base, comparison: 'current' })).toBeNull();
    });

    // The Bug 2 case: an active paying customer clicking "Upgrade" must NOT
    // route to Stripe Checkout — that creates a duplicate active subscription
    // on the same customer instead of swapping the price.
    it('routes paid users to the portal for upgrades', () => {
        expect(
            decidePlanAction({
                ...base,
                comparison: 'upgrade',
                hasActiveSub: true,
            })
        ).toMatchObject({
            label: 'Upgrade',
            target: 'portal',
            disabled: false,
        });
    });

    it('routes trial users to checkout for upgrades', () => {
        expect(
            decidePlanAction({
                ...base,
                comparison: 'upgrade',
                hasActiveSub: false,
            })
        ).toMatchObject({
            label: 'Upgrade',
            target: 'checkout',
            disabled: false,
        });
    });

    it('routes downgrades to the portal when the user has an active sub', () => {
        expect(
            decidePlanAction({
                ...base,
                comparison: 'downgrade',
                hasActiveSub: true,
            })
        ).toMatchObject({
            label: 'Downgrade',
            target: 'portal',
            disabled: false,
        });
    });

    it('disables and shows pending while this card is checking out', () => {
        expect(
            decidePlanAction({
                ...base,
                comparison: 'upgrade',
                hasActiveSub: false,
                isPendingThisCheckout: true,
                isAnyCheckoutPending: true,
            })
        ).toMatchObject({
            target: 'checkout',
            isPending: true,
            disabled: true,
        });
    });

    // Two trial-user upgrade cards exist (Pro and Max). When one is firing,
    // the other must lock so a rapid double-click can't open two checkout
    // sessions in parallel.
    it('disables sibling cards while any checkout is pending', () => {
        expect(
            decidePlanAction({
                ...base,
                comparison: 'upgrade',
                hasActiveSub: false,
                isPendingThisCheckout: false,
                isAnyCheckoutPending: true,
            })
        ).toMatchObject({
            target: 'checkout',
            isPending: false,
            disabled: true,
        });
    });

    it('disables and shows pending while the portal is opening', () => {
        expect(
            decidePlanAction({
                ...base,
                comparison: 'downgrade',
                hasActiveSub: true,
                isOpeningPortal: true,
            })
        ).toMatchObject({
            target: 'portal',
            isPending: true,
            disabled: true,
        });
    });
});

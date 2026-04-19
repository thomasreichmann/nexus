import { describe, expect, it } from 'vitest';
import { subscriptionStatusEnum } from '@nexus/db/schema';
import {
    PLAN_DISPLAY,
    comparePlans,
    getStatusBadge,
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

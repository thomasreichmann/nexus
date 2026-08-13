import { describe, expect, it } from 'vitest';
import { isTrialExpired } from './plans';

const NOW = new Date('2026-08-12T12:00:00Z');
const PAST = new Date('2026-08-11T12:00:00Z');
const FUTURE = new Date('2026-08-13T12:00:00Z');

describe('isTrialExpired', () => {
    it('is true for a trialing subscription past its trialEnd', () => {
        expect(
            isTrialExpired({ status: 'trialing', trialEnd: PAST }, NOW)
        ).toBe(true);
    });

    it('is false while the trial still has time left', () => {
        expect(
            isTrialExpired({ status: 'trialing', trialEnd: FUTURE }, NOW)
        ).toBe(false);
    });

    // The bound is strict, unlike `isInviteExpired`'s inclusive one: a trial
    // is live right up to `trialEnd` and over the instant after.
    it('is false exactly at trialEnd', () => {
        expect(isTrialExpired({ status: 'trialing', trialEnd: NOW }, NOW)).toBe(
            false
        );
    });

    it('is false when trialEnd is unset', () => {
        expect(
            isTrialExpired({ status: 'trialing', trialEnd: null }, NOW)
        ).toBe(false);
    });

    // `sponsored` is the one that matters: comped alpha testers have no Stripe
    // subscription and no trialEnd, and must never be cut off by trial expiry.
    it.each(['sponsored', 'active', 'past_due', 'canceled'] as const)(
        'is false for a %s subscription regardless of trialEnd',
        (status) => {
            expect(isTrialExpired({ status, trialEnd: PAST }, NOW)).toBe(false);
        }
    );
});

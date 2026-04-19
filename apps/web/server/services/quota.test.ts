import { describe, expect, it } from 'vitest';
import { QuotaExceededError, TrialExpiredError } from '@/server/errors';
import { PLAN_LIMITS } from './constants';
import { assertUploadAllowed, type QuotaContext } from './quota';

const oneGB = 1024 ** 3;
const NOW = new Date('2026-04-18T00:00:00Z');

function ctx(overrides: Partial<QuotaContext> = {}): QuotaContext {
    return {
        currentUsage: 0,
        subscription: null,
        ...overrides,
    };
}

describe('assertUploadAllowed', () => {
    describe('without a subscription', () => {
        it('falls back to the starter plan limit', () => {
            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: PLAN_LIMITS.starter - 1 }),
                    2,
                    NOW
                )
            ).toThrow(QuotaExceededError);
        });

        it('allows an upload that lands exactly at the starter limit', () => {
            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: PLAN_LIMITS.starter - oneGB }),
                    oneGB,
                    NOW
                )
            ).not.toThrow();
        });
    });

    describe('with an active subscription', () => {
        it('uses the subscription storageLimit, not PLAN_LIMITS', () => {
            // Custom limit below the starter default — proves we honor the
            // subscription's value rather than falling back to PLAN_LIMITS.
            const customLimit = 100 * oneGB;
            const subscription = {
                storageLimit: customLimit,
                status: 'active' as const,
                trialEnd: null,
            };

            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: customLimit - 1, subscription }),
                    2,
                    NOW
                )
            ).toThrow(QuotaExceededError);
        });

        it('allows uploads under the subscription limit', () => {
            const subscription = {
                storageLimit: PLAN_LIMITS.pro,
                status: 'active' as const,
                trialEnd: null,
            };

            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: 2 * 1024 ** 4, subscription }),
                    oneGB,
                    NOW
                )
            ).not.toThrow();
        });
    });

    describe('during a trial', () => {
        it('allows uploads while the trial is active', () => {
            const subscription = {
                storageLimit: PLAN_LIMITS.starter,
                status: 'trialing' as const,
                trialEnd: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
            };

            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: 0, subscription }),
                    oneGB,
                    NOW
                )
            ).not.toThrow();
        });

        it('throws TrialExpiredError once trialEnd is in the past', () => {
            const subscription = {
                storageLimit: PLAN_LIMITS.starter,
                status: 'trialing' as const,
                trialEnd: new Date(NOW.getTime() - 1),
            };

            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: 0, subscription }),
                    oneGB,
                    NOW
                )
            ).toThrow(TrialExpiredError);
        });

        it('prefers TrialExpiredError over QuotaExceededError when both apply', () => {
            const subscription = {
                storageLimit: PLAN_LIMITS.starter,
                status: 'trialing' as const,
                trialEnd: new Date(NOW.getTime() - 1),
            };

            expect(() =>
                assertUploadAllowed(
                    ctx({
                        currentUsage: PLAN_LIMITS.starter,
                        subscription,
                    }),
                    oneGB,
                    NOW
                )
            ).toThrow(TrialExpiredError);
        });

        it('does not treat trialing+null trialEnd as expired', () => {
            const subscription = {
                storageLimit: PLAN_LIMITS.starter,
                status: 'trialing' as const,
                trialEnd: null,
            };

            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: 0, subscription }),
                    oneGB,
                    NOW
                )
            ).not.toThrow();
        });
    });
});

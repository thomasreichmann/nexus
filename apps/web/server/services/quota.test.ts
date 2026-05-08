import { describe, expect, it, beforeEach } from 'vitest';
import {
    createMockDb,
    createStorageUsageFixture,
    type MockDb,
    type MockDbMocks,
    TEST_USER_ID,
} from '@nexus/db/testing';
import { QuotaExceededError, TrialExpiredError } from '@/server/errors';
import { PLAN_LIMITS } from './constants';
import { quotaService, type QuotaContext } from './quota';

const { assertUploadAllowed, checkQuota } = quotaService;
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
            // Push past the 105% soft cap to force rejection.
            const overSoftCap = Math.floor(PLAN_LIMITS.starter * 1.05) + oneGB;
            expect(() =>
                assertUploadAllowed(ctx({ currentUsage: overSoftCap }), 1, NOW)
            ).toThrow(QuotaExceededError);
        });

        it('allows an upload that lands exactly at the starter limit', () => {
            const result = assertUploadAllowed(
                ctx({ currentUsage: PLAN_LIMITS.starter - oneGB }),
                oneGB,
                NOW
            );
            expect(result.allowed).toBe(true);
            expect(result.limitBytes).toBe(PLAN_LIMITS.starter);
        });
    });

    describe('with an active subscription', () => {
        it('uses the subscription storageLimit, not PLAN_LIMITS', () => {
            const customLimit = 100 * oneGB;
            const subscription = {
                storageLimit: customLimit,
                status: 'active' as const,
                trialEnd: null,
            };

            // 110% of the limit blows past the 105% soft cap.
            const overSoftCap = Math.floor(customLimit * 1.1);
            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: overSoftCap, subscription }),
                    1,
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

    describe('soft limit (105%)', () => {
        const subscription = {
            storageLimit: 100 * oneGB,
            status: 'active' as const,
            trialEnd: null,
        };

        it('allows an upload that lands within the 5% overage band', () => {
            // 100% used + 4% upload = 104% projected, under 105% cap.
            const result = assertUploadAllowed(
                ctx({ currentUsage: 100 * oneGB, subscription }),
                4 * oneGB,
                NOW
            );

            expect(result.allowed).toBe(true);
            expect(result.nearLimit).toBe(true);
        });

        it('rejects when the projected usage exceeds 105% of the limit', () => {
            // 100% used + 6% upload = 106% projected, over cap.
            expect(() =>
                assertUploadAllowed(
                    ctx({ currentUsage: 100 * oneGB, subscription }),
                    6 * oneGB,
                    NOW
                )
            ).toThrow(QuotaExceededError);
        });

        it('attaches structured details on rejection', () => {
            try {
                assertUploadAllowed(
                    ctx({ currentUsage: 100 * oneGB, subscription }),
                    6 * oneGB,
                    NOW
                );
            } catch (error) {
                expect(error).toBeInstanceOf(QuotaExceededError);
                expect((error as QuotaExceededError).details).toEqual({
                    usedBytes: 100 * oneGB,
                    limitBytes: 100 * oneGB,
                    requestedBytes: 6 * oneGB,
                });
            }
        });
    });

    describe('nearLimit flag', () => {
        const subscription = {
            storageLimit: 100 * oneGB,
            status: 'active' as const,
            trialEnd: null,
        };

        it('is false when projected usage is well under 90%', () => {
            const result = assertUploadAllowed(
                ctx({ currentUsage: 50 * oneGB, subscription }),
                10 * oneGB,
                NOW
            );
            expect(result.nearLimit).toBe(false);
        });

        it('is true when projected usage exceeds 90% of the limit', () => {
            const result = assertUploadAllowed(
                ctx({ currentUsage: 80 * oneGB, subscription }),
                15 * oneGB,
                NOW
            );
            expect(result.nearLimit).toBe(true);
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

describe('checkQuota', () => {
    let db: MockDb;
    let mocks: MockDbMocks;

    beforeEach(() => {
        const mockDb = createMockDb();
        db = mockDb.db;
        mocks = mockDb.mocks;
    });

    it('reads usage from storage_usage and allows when under limit', async () => {
        mocks.storageUsage.findFirst.mockResolvedValue(
            createStorageUsageFixture({ usedBytes: 100, fileCount: 1 })
        );

        const result = await checkQuota(db, TEST_USER_ID, oneGB, undefined);

        expect(result.allowed).toBe(true);
        expect(result.usedBytes).toBe(100);
        expect(result.limitBytes).toBe(PLAN_LIMITS.starter);
    });

    it('treats a missing usage row as zero usage', async () => {
        mocks.storageUsage.findFirst.mockResolvedValue(undefined);

        const result = await checkQuota(db, TEST_USER_ID, oneGB, undefined);

        expect(result.allowed).toBe(true);
        expect(result.usedBytes).toBe(0);
    });

    it('throws QuotaExceededError with details when over the soft cap', async () => {
        mocks.storageUsage.findFirst.mockResolvedValue(
            createStorageUsageFixture({
                usedBytes: PLAN_LIMITS.starter,
                fileCount: 100,
            })
        );

        await expect(
            checkQuota(
                db,
                TEST_USER_ID,
                Math.floor(PLAN_LIMITS.starter * 0.1),
                undefined
            )
        ).rejects.toThrow(QuotaExceededError);
    });
});

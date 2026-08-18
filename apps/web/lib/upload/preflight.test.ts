import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, SOFT_LIMIT_MULTIPLIER } from '@nexus/db/plans';
import { preflightQuota } from './preflight';

const QUOTA = PLAN_LIMITS.starter;
const SOFT_CAP = Math.floor(QUOTA * SOFT_LIMIT_MULTIPLIER);

describe('preflightQuota', () => {
    it('is ok well under the limit', () => {
        expect(
            preflightQuota({
                pendingBytes: 100,
                usedBytes: 0,
                quotaBytes: QUOTA,
            })
        ).toBe('ok');
    });

    it('is ok with an empty selection at high usage', () => {
        expect(
            preflightQuota({
                pendingBytes: 0,
                usedBytes: QUOTA * 0.89,
                quotaBytes: QUOTA,
            })
        ).toBe('ok');
    });

    it('warns near the limit once projected usage clears 90%', () => {
        expect(
            preflightQuota({
                pendingBytes: QUOTA * 0.2,
                usedBytes: QUOTA * 0.75,
                quotaBytes: QUOTA,
            })
        ).toBe('near-limit');
    });

    it('exactly 90% projected is not yet near-limit (strict bound, like the server)', () => {
        expect(
            preflightQuota({
                pendingBytes: QUOTA * 0.15,
                usedBytes: QUOTA * 0.75,
                quotaBytes: QUOTA,
            })
        ).toBe('ok');
    });

    it('is over-limit past 100% but inside the soft cap', () => {
        expect(
            preflightQuota({
                pendingBytes: 1024,
                usedBytes: QUOTA,
                quotaBytes: QUOTA,
            })
        ).toBe('over-limit');
    });

    it('exactly the soft cap still lands (server accepts <= soft cap)', () => {
        expect(
            preflightQuota({
                pendingBytes: SOFT_CAP - QUOTA,
                usedBytes: QUOTA,
                quotaBytes: QUOTA,
            })
        ).toBe('over-limit');
    });

    it('blocks one byte past the soft cap', () => {
        expect(
            preflightQuota({
                pendingBytes: SOFT_CAP - QUOTA + 1,
                usedBytes: QUOTA,
                quotaBytes: QUOTA,
            })
        ).toBe('blocked');
    });

    it('blocks a selection that dwarfs the remaining space', () => {
        expect(
            preflightQuota({
                pendingBytes: QUOTA,
                usedBytes: QUOTA * 0.5,
                quotaBytes: QUOTA,
            })
        ).toBe('blocked');
    });
});

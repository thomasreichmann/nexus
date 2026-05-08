import type { DB } from '@nexus/db';
import { createStorageUsageRepo } from '@nexus/db/repo/storage-usage';
import type { Subscription } from '@nexus/db/repo/subscriptions';
import { QuotaExceededError, TrialExpiredError } from '@/server/errors';
import { PLAN_LIMITS } from './constants';

// Optimistic concurrency: pre-checks pass at 100%, but we accept up to 105%
// of the plan limit so a burst of concurrent uploads (each individually
// passing the check before any have written) can land without rejection.
// The 5% bound also covers small drift between storage_usage and reality.
const SOFT_LIMIT_MULTIPLIER = 1.05;
// Threshold for surfacing a "near limit" warning to the client (e.g. banner).
const NEAR_LIMIT_RATIO = 0.9;

export interface QuotaContext {
    currentUsage: number;
    // Narrow Pick so tests can supply minimal fixtures without constructing
    // the full Subscription object.
    subscription: Pick<
        Subscription,
        'storageLimit' | 'status' | 'trialEnd'
    > | null;
}

export interface QuotaCheckResult {
    allowed: true;
    usedBytes: number;
    limitBytes: number;
    remainingBytes: number;
    nearLimit: boolean;
}

/**
 * Pure check: given the current usage snapshot and (optional) subscription,
 * decide whether `additionalBytes` can be accepted. Trial expiry is checked
 * before quota so an expired-trial user doesn't see a misleading quota error.
 *
 * Throws on rejection; returns the structured result on success so callers
 * can surface usage and warning state in the same call.
 */
function assertUploadAllowed(
    ctx: QuotaContext,
    additionalBytes: number,
    now: Date = new Date()
): QuotaCheckResult {
    const { subscription, currentUsage } = ctx;

    if (
        subscription?.status === 'trialing' &&
        subscription.trialEnd &&
        subscription.trialEnd < now
    ) {
        throw new TrialExpiredError();
    }

    const limitBytes = subscription?.storageLimit ?? PLAN_LIMITS.starter;
    const projectedUsage = currentUsage + additionalBytes;
    const softCap = Math.floor(limitBytes * SOFT_LIMIT_MULTIPLIER);

    if (projectedUsage > softCap) {
        throw new QuotaExceededError({
            usedBytes: currentUsage,
            limitBytes,
            requestedBytes: additionalBytes,
        });
    }

    return {
        allowed: true,
        usedBytes: currentUsage,
        limitBytes,
        remainingBytes: Math.max(limitBytes - currentUsage, 0),
        nearLimit: projectedUsage > limitBytes * NEAR_LIMIT_RATIO,
    };
}

/**
 * Loads the current usage from `storage_usage` and runs the pure quota check.
 * Use this from upload entry points; the bare `assertUploadAllowed` is for
 * tests and callers that already have a usage snapshot.
 */
async function checkQuota(
    db: DB,
    userId: string,
    requestedBytes: number,
    sub: Subscription | undefined
): Promise<QuotaCheckResult> {
    const usageRepo = createStorageUsageRepo(db);
    const { usedBytes } = await usageRepo.getUsage(userId);
    return assertUploadAllowed(
        { currentUsage: usedBytes, subscription: sub ?? null },
        requestedBytes
    );
}

export const quotaService = {
    assertUploadAllowed,
    checkQuota,
} as const;

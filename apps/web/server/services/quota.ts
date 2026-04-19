import type { Subscription } from '@nexus/db/repo/subscriptions';
import { QuotaExceededError, TrialExpiredError } from '@/server/errors';
import { PLAN_LIMITS } from './constants';

export interface QuotaContext {
    currentUsage: number;
    subscription: Pick<
        Subscription,
        'storageLimit' | 'status' | 'trialEnd'
    > | null;
}

/**
 * Pure check: given the current usage snapshot and (optional) subscription,
 * decide whether `additionalBytes` can be accepted. Trial expiry is checked
 * before quota so an expired-trial user doesn't see a misleading quota error.
 */
export function assertUploadAllowed(
    ctx: QuotaContext,
    additionalBytes: number,
    now: Date = new Date()
): void {
    const { subscription, currentUsage } = ctx;

    if (
        subscription?.status === 'trialing' &&
        subscription.trialEnd &&
        subscription.trialEnd < now
    ) {
        throw new TrialExpiredError();
    }

    const quotaBytes = subscription?.storageLimit ?? PLAN_LIMITS.starter;
    if (currentUsage + additionalBytes > quotaBytes) {
        throw new QuotaExceededError('Storage quota exceeded');
    }
}

import { NEAR_LIMIT_RATIO, softCapBytes } from '@nexus/db/plans';

export interface PreflightInput {
    /** Summed size of the rows the Upload button would submit (pending only). */
    pendingBytes: number;
    usedBytes: number;
    quotaBytes: number;
}

/**
 * What the queued selection means for the user's quota, judged before Upload
 * is clicked — the client-side mirror of the server's `checkQuota`
 * (`server/services/quota.ts`), sharing its constants so the two can't drift.
 *
 * - `blocked`: the wave can't fully land — projected usage clears even the
 *   105% soft cap the server enforces, so uploading is refused up front.
 * - `over-limit`: the wave lands (inside the soft cap's grace band) but puts
 *   the account past 100% of its plan.
 * - `near-limit`: the server's `nearLimit` signal — projected usage above 90%.
 *
 * Byte comparisons only: `getUsage().percentage` is clamped at 100 and can't
 * express any of these states.
 */
export type PreflightLevel = 'ok' | 'near-limit' | 'over-limit' | 'blocked';

export function preflightQuota({
    pendingBytes,
    usedBytes,
    quotaBytes,
}: PreflightInput): PreflightLevel {
    const projected = usedBytes + pendingBytes;
    if (projected > softCapBytes(quotaBytes)) return 'blocked';
    if (projected > quotaBytes) return 'over-limit';
    if (projected > quotaBytes * NEAR_LIMIT_RATIO) return 'near-limit';
    return 'ok';
}

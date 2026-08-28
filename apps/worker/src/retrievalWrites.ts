import { restoreWindowEnd } from '@nexus/db/objectState';
import type { Retrieval, RetrievalRepo } from '@nexus/db/repo/retrievals';

/**
 * The retrieval outcomes both worker S3 paths write — the readiness poll and
 * the restore-initiation job. They reach the same two endings from different
 * questions, so the download-window policy and the missing-object message are
 * decided here once rather than restated per caller.
 *
 * Neither catches. What a failed write means belongs to the caller's own
 * accounting (both report the row as errored and leave it `pending` for the
 * next run), and swallowing here would take that choice away.
 */

export function markRetrievalReady(
    retrievalRepo: RetrievalRepo,
    retrievalId: string,
    expiresAt: Date | undefined
): Promise<Retrieval | undefined> {
    const now = new Date();
    return retrievalRepo.updateStatus(retrievalId, 'ready', {
        readyAt: now,
        // A readable object with no S3 expiry of its own — one that was warm
        // all along, or a restore whose header carried no `expiry-date` — takes
        // a window the same length as a real restore's, so both present one
        // download-window state to the UI.
        expiresAt: expiresAt ?? restoreWindowEnd(now),
    });
}

/**
 * Settle a retrieval whose object is no longer in the bucket.
 *
 * Nothing will ever restore an object that does not exist, so re-HEADing a 404
 * every 15 minutes until the 48h stuck-retrieval check notices is pure waste —
 * and it would hold the file's active-retrieval slot the whole time. `failed`
 * releases that slot, so the user can ask again if the object comes back.
 */
export function markRetrievalMissing(
    retrievalRepo: RetrievalRepo,
    retrievalId: string
): Promise<Retrieval | undefined> {
    return retrievalRepo.updateStatus(retrievalId, 'failed', {
        failedAt: new Date(),
        errorMessage: 'Object no longer exists in S3',
    });
}

/**
 * Record that AWS rejected this file's restore. `errorMessage` holds raw AWS
 * SDK text (ARNs, account ids, bucket names): it is for operators, and nothing
 * serves this column to a client.
 */
export function markRetrievalFailed(
    retrievalRepo: RetrievalRepo,
    retrievalId: string,
    errorMessage: string
): Promise<Retrieval | undefined> {
    return retrievalRepo.updateStatus(retrievalId, 'failed', {
        failedAt: new Date(),
        errorMessage,
    });
}

import { HeadObjectCommand } from '@aws-sdk/client-s3';
import {
    interpretObjectState,
    isObjectMissing,
    isReadable,
    restoreWindowEnd,
} from '@nexus/db/objectState';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { getS3, requireEnv } from './aws';
import { enqueueJob } from './jobs';
import type { PendingRetrievalWithFile } from '@nexus/db/repo/retrievals';
import type { DB } from '@nexus/db';

/**
 * Cap on rows examined per run. Deep Archive restores take 12-48h and this
 * runs every 15 minutes, so a leftover is picked up long before anyone could
 * notice; the cap exists only so a bulk restore can't run the 120s Lambda
 * timeout out mid-write. `findPendingWithFiles` orders oldest-first, so the
 * overflow drains in request order rather than starving the earliest rows.
 */
const MAX_ROWS_PER_RUN = 400;

export interface PollSummary {
    /** Rows HEADed this run. */
    checked: number;
    /** Rows that S3 says are now readable, and which we marked `ready`. */
    ready: number;
    /** Rows still archived or restoring. */
    waiting: number;
    /** Rows whose object is gone from the bucket, and which we marked `failed`. */
    missing: number;
    /** Rows whose HEAD failed — left pending for the next run. */
    errored: number;
    /** More pending rows existed than the per-run cap. */
    capped: boolean;
}

/** What one pending row turned into. Keyed to match `PollSummary`'s counters. */
type RowOutcome = 'ready' | 'waiting' | 'missing' | 'errored';

/**
 * Observe which pending retrievals S3 has finished restoring.
 *
 * Replaces the S3 -> SNS -> webhook rail (#416). Completion is *observed*, not
 * delivered: nothing tells us a restore finished, so we ask — but only about
 * retrievals we ourselves are waiting on. That bounds the work by our own
 * pending set (K rows => K HEADs) instead of by S3's event rate, which is what
 * put 862 messages in a DLQ and saturated the connection pooler.
 *
 * Rows are processed serially, so exactly one query is ever in flight and the
 * pool never opens a second connection.
 *
 * Deliberately does NOT send the "your file is ready" email or capture the
 * PostHog `RetrievalReady` event, which the deleted webhook used to do: both
 * need Resend/PostHog credentials and templates the worker bundle does not
 * carry. Deferred to #418 — until that lands, a completed retrieval is
 * visible in the UI but nothing notifies the user.
 */
export async function pollRetrievals(db: DB): Promise<PollSummary> {
    const retrievalRepo = createRetrievalRepo(db);
    // Fetch one past the cap purely to detect overflow.
    const pending = await retrievalRepo.findPendingWithFiles(
        MAX_ROWS_PER_RUN + 1
    );
    const capped = pending.length > MAX_ROWS_PER_RUN;
    const rows = capped ? pending.slice(0, MAX_ROWS_PER_RUN) : pending;

    const summary: PollSummary = {
        checked: 0,
        ready: 0,
        waiting: 0,
        missing: 0,
        errored: 0,
        capped,
    };

    for (const row of rows) {
        summary.checked++;
        summary[await pollRow(db, retrievalRepo, row)]++;
    }

    if (capped) {
        console.warn(
            `Retrieval poll hit its ${MAX_ROWS_PER_RUN}-row cap; the remainder is picked up next run.`
        );
    }

    // Nothing succeeding is not a per-row problem — it is S3, IAM, or a
    // missing S3_BUCKET, and the `nexus-worker-errors` alarm (scheduler.tf)
    // only ever sees a whole-invocation throw. Swallowing every failure here
    // is what would leave that alarm green through a total outage, which is
    // the one thing it exists to catch.
    //
    // With a single pending row this does fire on one bad key. That is the
    // right escalation: a retrieval that cannot complete needs a human either
    // way, and the alarm's >3-errors-per-hour threshold against a 15-minute
    // cadence means the failure has to persist for a full hour first. The one
    // row that would otherwise error forever — a vanished object — is settled
    // as `failed` by `failMissing` rather than counted here.
    if (summary.errored > 0 && summary.errored === summary.checked) {
        console.error(
            'Retrieval poll: every pending row failed.',
            JSON.stringify(summary)
        );
        throw new Error(
            `Retrieval poll failed for all ${summary.checked} pending rows; see the warnings above.`
        );
    }

    return summary;
}

/** Finish one pending row off, mapping every ending onto a `RowOutcome`. */
async function pollRow(
    db: DB,
    retrievalRepo: ReturnType<typeof createRetrievalRepo>,
    row: PendingRetrievalWithFile
): Promise<RowOutcome> {
    try {
        const response = await getS3().send(
            new HeadObjectCommand({
                Bucket: requireEnv('S3_BUCKET'),
                Key: row.s3Key,
            })
        );
        const state = interpretObjectState({
            storageClass: response.StorageClass,
            restoreHeader: response.Restore,
        });

        if (!isReadable(state)) return 'waiting';

        const now = new Date();
        await retrievalRepo.updateStatus(row.id, 'ready', {
            readyAt: now,
            expiresAt: state.expiresAt ?? restoreWindowEnd(now),
        });

        // A thumbnail that failed because its original was already cold
        // can finally be generated now that a readable copy exists.
        if (row.thumbnailStatus === 'failed_cold') {
            await enqueueThumbnail(db, row.fileId);
        }
        return 'ready';
    } catch (error) {
        if (isObjectMissing(error)) return failMissing(retrievalRepo, row);

        // Leave the row pending: the next run retries it, and the
        // stuck-retrieval check in check-s3-event-health escalates
        // anything still waiting after 48h.
        console.warn(
            `Retrieval poll failed for retrieval ${row.id} (file ${row.fileId}):`,
            error
        );
        return 'errored';
    }
}

/**
 * Settle a retrieval whose object is no longer in the bucket.
 *
 * Nothing will ever restore an object that does not exist, so re-HEADing a 404
 * every 15 minutes until the 48h stuck-retrieval check notices is pure waste —
 * and it would hold the file's active-retrieval slot the whole time. `failed`
 * releases that slot, so the user can ask again if the object comes back.
 */
async function failMissing(
    retrievalRepo: ReturnType<typeof createRetrievalRepo>,
    row: PendingRetrievalWithFile
): Promise<RowOutcome> {
    try {
        await retrievalRepo.updateStatus(row.id, 'failed', {
            failedAt: new Date(),
            errorMessage: 'Object no longer exists in S3',
        });
        console.warn(
            `Retrieval ${row.id} failed: object ${row.s3Key} (file ${row.fileId}) no longer exists in S3.`
        );
        return 'missing';
    } catch (error) {
        // The HEAD answered, so this is a DB problem, not an S3 one — errored,
        // so it retries next run rather than being reported as settled.
        console.warn(
            `Failed to mark retrieval ${row.id} as failed after a missing object:`,
            error
        );
        return 'errored';
    }
}

// A thumbnail re-enqueue must not undo a retrieval that is genuinely ready —
// the row is already marked, and a lost thumbnail self-heals on the next
// restore or a manual regenerate.
async function enqueueThumbnail(db: DB, fileId: string): Promise<void> {
    try {
        await enqueueJob(db, {
            type: 'generate-thumbnail',
            payload: { fileId },
        });
    } catch (error) {
        console.warn(
            `Failed to enqueue cold-thumbnail regeneration for file ${fileId}:`,
            error
        );
    }
}

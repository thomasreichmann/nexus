import { HeadObjectCommand } from '@aws-sdk/client-s3';
import {
    interpretObjectState,
    isReadable,
    restoreWindowEnd,
} from '@nexus/db/object-state';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { getS3, requireEnv } from './aws';
import { enqueueJob } from './jobs';
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
    /** Rows whose HEAD failed — left pending for the next run. */
    errored: number;
    /** More pending rows existed than the per-run cap. */
    capped: boolean;
}

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
 * carry. Deferred to a follow-up — until it lands, a completed retrieval is
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
        errored: 0,
        capped,
    };

    for (const row of rows) {
        summary.checked++;
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

            if (!isReadable(state)) {
                summary.waiting++;
                continue;
            }

            const now = new Date();
            await retrievalRepo.updateStatus(row.id, 'ready', {
                readyAt: now,
                expiresAt: state.expiresAt ?? restoreWindowEnd(now),
            });
            summary.ready++;

            // A thumbnail that failed because its original was already cold
            // can finally be generated now that a readable copy exists.
            if (row.thumbnailStatus === 'failed_cold') {
                await enqueueThumbnail(db, row.fileId);
            }
        } catch (error) {
            // Leave the row pending: the next run retries it, and the
            // stuck-retrieval check in check-s3-event-health escalates
            // anything still waiting after 48h.
            summary.errored++;
            console.warn(
                `Retrieval poll failed for retrieval ${row.id} (file ${row.fileId}):`,
                error
            );
        }
    }

    if (capped) {
        console.warn(
            `Retrieval poll hit its ${MAX_ROWS_PER_RUN}-row cap; the remainder is picked up next run.`
        );
    }

    return summary;
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

import { createSemaphore } from '@nexus/async';
import {
    isObjectMissing,
    isReadable,
    type ObjectState,
} from '@nexus/db/objectState';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { headObjectState, S3_CONCURRENCY } from './aws';
import { enqueueJob } from './jobs';
import { partitionIntoChunks } from './partition';
import { markRetrievalMissing, markRetrievalReady } from './retrievalWrites';
import type { RetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import type {
    PendingRetrievalWithFile,
    RestoreHorizons,
} from '@nexus/db/repo/retrievals';
import type { DB } from '@nexus/db';

/**
 * How long after `initiatedAt` a restore of each tier could plausibly have
 * finished. Rows younger than their tier's horizon are skipped in the query,
 * not fetched and discarded (#423).
 *
 * Deliberately below the documented completion times — Deep Archive quotes
 * 12-48h for Standard and 48h for Bulk — because this is the moment we start
 * asking, not an expectation of an answer. Under-shooting costs a few HEADs;
 * over-shooting delays the whole request. `readyAt - initiatedAt` is recorded
 * per row, so the alpha's own numbers are what these get tuned to.
 *
 * Expedited is minutes on Glacier Flexible and unavailable on Deep Archive, so
 * it has no horizon to wait out.
 */
const COMPLETION_HORIZONS: RestoreHorizons = {
    expedited: 0,
    standard: 6 * 60 * 60 * 1000,
    bulk: 24 * 60 * 60 * 1000,
};

/**
 * Cap on rows examined per run. It exists only so one run can't spend the 120s
 * Lambda timeout mid-write; `findPendingWithFiles` orders oldest-first, so any
 * overflow drains in request order rather than starving the earliest rows.
 *
 * The horizon above is what lets this be a full-archive number instead of the
 * old 400 (#423): a run's budget is now spent only on rows that could actually
 * be done, so an 8,934-file request drains in two runs rather than waiting out
 * 22 of them. The HEADs are concurrent and the writes are serial, so the ceiling
 * is ~5,000 serial UPDATEs against a same-region pooler — tens of seconds,
 * inside the timeout with room to spare.
 */
const MAX_ROWS_PER_RUN = 5000;

/**
 * Cap on requests whose zip builds are started per run, for the same reason as
 * `MAX_ROWS_PER_RUN`: bound the invocation. Lower because each one costs a
 * partition and a handful of writes rather than a single HEAD, and because a
 * leftover waits 15 minutes against restores measured in days.
 */
const MAX_REQUESTS_PER_RUN = 25;

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
    /** Requests partitioned into zip chunks by *this* run. */
    requestsPartitioned: number;
    /** `build-retrieval-zip` jobs published this run. */
    zipJobsEnqueued: number;
    /** Requests whose zip build could not be started — retried next run. */
    zipErrored: number;
    /** True when the buildable-request lookup itself failed. */
    zipLookupFailed: boolean;
}

/** What one pending row turned into. Keyed to match `PollSummary`'s counters. */
type RowOutcome = 'ready' | 'waiting' | 'missing' | 'errored';

/**
 * Observe which pending retrievals S3 has finished restoring.
 *
 * Replaces the S3 -> SNS -> webhook rail (#416). Completion is *observed*, not
 * delivered: nothing tells us a restore finished, so we ask — but only about
 * retrievals we ourselves are waiting on, and only once they are old enough to
 * plausibly be done. That bounds the work by our own pending set (K due rows =>
 * K HEADs) instead of by S3's event rate, which is what put 862 messages in a
 * DLQ and saturated the connection pooler.
 *
 * The HEADs run concurrently and the DB writes that follow run serially, so
 * exactly one query is ever in flight and the pool still never opens a second
 * connection (#423). Every row is asked about before any row is written, which
 * is also what makes the run's cost predictable: one burst of S3 latency, then
 * a straight line of updates.
 */
export async function pollRetrievals(db: DB): Promise<PollSummary> {
    const retrievalRepo = createRetrievalRepo(db);
    // Fetch one past the cap purely to detect overflow.
    const pending = await retrievalRepo.findPendingWithFiles(
        MAX_ROWS_PER_RUN + 1,
        COMPLETION_HORIZONS
    );
    const capped = pending.length > MAX_ROWS_PER_RUN;
    const rows = capped ? pending.slice(0, MAX_ROWS_PER_RUN) : pending;

    const heads = createSemaphore(S3_CONCURRENCY);
    const observations = await Promise.all(
        rows.map((row) => heads.run(() => headRow(row)))
    );

    const summary: PollSummary = {
        checked: 0,
        ready: 0,
        waiting: 0,
        missing: 0,
        errored: 0,
        capped,
        requestsPartitioned: 0,
        zipJobsEnqueued: 0,
        zipErrored: 0,
        zipLookupFailed: false,
    };

    for (const observation of observations) {
        summary.checked++;
        summary[await settleRow(db, retrievalRepo, observation)]++;
    }

    // After the flips, not interleaved with them: a request is only buildable
    // once every one of its files is `ready`, and the row that completes it may
    // be anywhere in this loop.
    await startZipBuilds(db, summary);

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

/** What one HEAD said about a row, before anything is written for it. */
type RowObservation =
    | { row: PendingRetrievalWithFile; state: ObjectState }
    | { row: PendingRetrievalWithFile; error: unknown };

/**
 * Ask S3 about one row. Writes nothing — the whole point of splitting this out
 * is that the S3 half can run concurrently while the DB half stays serial.
 */
async function headRow(row: PendingRetrievalWithFile): Promise<RowObservation> {
    try {
        return { row, state: await headObjectState(row.s3Key) };
    } catch (error) {
        return { row, error };
    }
}

/** Finish one observed row off, mapping every ending onto a `RowOutcome`. */
async function settleRow(
    db: DB,
    retrievalRepo: ReturnType<typeof createRetrievalRepo>,
    observation: RowObservation
): Promise<RowOutcome> {
    const { row } = observation;

    if ('error' in observation) {
        const { error } = observation;
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

    const { state } = observation;
    if (!isReadable(state)) return 'waiting';

    try {
        await markRetrievalReady(
            retrievalRepo,
            row.id,
            state.expiresAt,
            row.restoreDaysToKeep
        );

        // A thumbnail that failed because its original was already cold
        // can finally be generated now that a readable copy exists.
        if (row.thumbnailStatus === 'failed_cold') {
            await enqueueThumbnail(db, row.fileId);
        }
        return 'ready';
    } catch (error) {
        // The HEAD answered, so this is a DB problem: errored, so the next run
        // retries it rather than reporting the row as settled.
        console.warn(
            `Failed to mark retrieval ${row.id} ready (file ${row.fileId}):`,
            error
        );
        return 'errored';
    }
}

/** The poll's half of settling a vanished object: the write, plus the log. */
async function failMissing(
    retrievalRepo: ReturnType<typeof createRetrievalRepo>,
    row: PendingRetrievalWithFile
): Promise<RowOutcome> {
    try {
        await markRetrievalMissing(retrievalRepo, row.id);
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

/**
 * Start the zip build for every request whose last file has thawed (#424).
 *
 * Failures are counted, not thrown: the retrievals this run flipped are
 * correctly `ready` either way, and `findBuildable` re-offers an unbuilt
 * request on every subsequent run, so a transient DB or SQS problem costs 15
 * minutes rather than the whole invocation. A persistent one shows up as a
 * `zipErrored` count in the logged summary and as a request that never
 * completes.
 */
async function startZipBuilds(db: DB, summary: PollSummary): Promise<void> {
    const requestRepo = createRetrievalRequestRepo(db);

    let requestIds: string[];
    try {
        requestIds = await requestRepo.findBuildable(MAX_REQUESTS_PER_RUN);
    } catch (error) {
        // Its own flag rather than a `zipErrored` bump: no request was even
        // named here, so counting it as one failed request would misreport the
        // scale of the problem in the line an operator reads.
        console.warn('Failed to look up requests ready to zip:', error);
        summary.zipLookupFailed = true;
        return;
    }

    for (const requestId of requestIds) {
        try {
            const { partitioned, enqueued } = await startZipBuild(
                db,
                requestRepo,
                requestId
            );
            if (partitioned) summary.requestsPartitioned++;
            summary.zipJobsEnqueued += enqueued;
        } catch (error) {
            console.warn(
                `Failed to start the zip build for retrieval request ${requestId}:`,
                error
            );
            summary.zipErrored++;
        }
    }
}

/**
 * Partition one request into chunks and publish a build job per chunk.
 *
 * Both halves are idempotent, which is what lets the reconciling scan re-offer
 * a half-finished request: the artifact insert conflicts away against the
 * (request, position) unique index, and the enqueue list is read back from the
 * `pending` rows rather than taken from the insert's result, so chunks a
 * previous run wrote but never published still get a job.
 *
 * The partition writes artifacts and their file assignments in one transaction
 * because the job only knows its file set through `items.artifact_id`: an
 * artifact that exists with nothing assigned to it would be a build that can
 * only fail.
 */
async function startZipBuild(
    db: DB,
    requestRepo: RetrievalRequestRepo,
    requestId: string
): Promise<{ partitioned: boolean; enqueued: number }> {
    let artifacts = await requestRepo.findArtifacts(requestId);
    const partitioned = artifacts.length === 0;

    // Any artifact at all means the partition has run. Keying off `pending`
    // instead would re-partition a request whose chunks are mid-build on every
    // one of the 15-minute runs it takes to finish them.
    if (partitioned) {
        const chunks = partitionIntoChunks(
            await requestRepo.findFiles(requestId)
        );

        await db.transaction(async (tx) => {
            const txRepo = createRetrievalRequestRepo(tx);
            const inserted = await txRepo.insertArtifacts(
                chunks.map((_, position) => ({
                    id: crypto.randomUUID(),
                    requestId,
                    position,
                }))
            );

            // Only assign for chunks this call actually created. A conflicted
            // position belongs to a concurrent run whose own assignment covers
            // it, and re-pointing its items here could split a chunk across
            // two artifacts.
            for (const artifact of inserted) {
                await txRepo.assignItemsToArtifact(
                    requestId,
                    artifact.id,
                    chunks[artifact.position].map((file) => file.fileId)
                );
            }
        });

        artifacts = await requestRepo.findArtifacts(requestId);
    }

    const pending = artifacts.filter(
        (artifact) => artifact.status === 'pending'
    );
    for (const artifact of pending) {
        await enqueueJob(db, {
            type: 'build-retrieval-zip',
            payload: { artifactId: artifact.id },
        });
    }

    return { partitioned, enqueued: pending.length };
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

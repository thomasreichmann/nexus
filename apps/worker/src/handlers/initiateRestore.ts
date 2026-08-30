import { RestoreObjectCommand } from '@aws-sdk/client-s3';
import { createSemaphore } from '@nexus/async';
import {
    DEFAULT_RESTORE_DAYS_TO_KEEP,
    isObjectMissing,
    isReadable,
    type ObjectState,
    type RestoreTier,
} from '@nexus/db/objectState';
import { createRetrievalRequestRepo } from '@nexus/db/repo/retrievalRequests';
import { createRetrievalRepo } from '@nexus/db/repo/retrievals';
import { getS3, headObjectState, requireEnv, S3_CONCURRENCY } from '../aws';
import {
    markRetrievalFailed,
    markRetrievalMissing,
    markRetrievalReady,
} from '../retrievalWrites';
import type { PendingRequestRetrieval } from '@nexus/db/repo/retrievalRequests';
import type { RetrievalRepo } from '@nexus/db/repo/retrievals';
import type { HandlerContext } from '../registry';

/** The `Tier` value S3's RestoreObject takes for each of ours. */
const S3_TIER: Record<RestoreTier, 'Expedited' | 'Standard' | 'Bulk'> = {
    expedited: 'Expedited',
    standard: 'Standard',
    bulk: 'Bulk',
};

/**
 * S3's answer when the object already has a restore in flight. Not a failure:
 * it means somebody — a concurrent request over the same file, or an earlier
 * delivery of this very job — already asked for exactly what we want.
 */
function isRestoreAlreadyInProgress(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { name, $metadata } = error as {
        name?: unknown;
        $metadata?: { httpStatusCode?: number };
    };
    return (
        name === 'RestoreAlreadyInProgress' || $metadata?.httpStatusCode === 409
    );
}

function toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * What S3 said about one row, and therefore what to write for it.
 *
 * `restoring` covers both "somebody else is already restoring this" and "we
 * just asked": neither needs a write, because the row is already `pending` and
 * the readiness poll is what observes the ending.
 */
type RowPlan =
    | { row: PendingRequestRetrieval; result: 'ready'; expiresAt?: Date }
    | { row: PendingRequestRetrieval; result: 'restoring' }
    | { row: PendingRequestRetrieval; result: 'missing' }
    | { row: PendingRequestRetrieval; result: 'failed'; message: string };

interface InitiateRestoreSummary {
    /** Rows this run asked S3 about. */
    planned: number;
    /** Rows S3 could already serve, which we marked `ready`. */
    ready: number;
    /** Rows now waiting on a restore — ours or somebody else's. */
    restoring: number;
    /** Rows whose object is gone from the bucket, which we marked `failed`. */
    missing: number;
    /** Rows whose RestoreObject was rejected, which we marked `failed`. */
    failed: number;
    /** Rows whose status write failed — still `pending`, retried next run. */
    errored: number;
}

/**
 * Ask S3 about one row and, if it is genuinely cold, start its restore.
 *
 * The HEAD comes first because S3 owns object state (#416): a warm object never
 * needs a restore, and one already restoring must not be asked again. A HEAD
 * that fails for any reason other than a missing object falls through as
 * `archived` rather than becoming its own failure — the RestoreObject below
 * hits the same outage and records it against the row, instead of two failure
 * paths reporting one problem differently.
 */
async function planRow(
    row: PendingRequestRetrieval,
    tier: RestoreTier,
    bucket: string
): Promise<RowPlan> {
    let state: ObjectState;
    try {
        state = await headObjectState(row.s3Key);
    } catch (error) {
        if (isObjectMissing(error)) return { row, result: 'missing' };
        console.warn(
            `HeadObject failed for retrieval ${row.retrievalId} (file ${row.fileId}); treating object as archived:`,
            error
        );
        state = { availability: 'archived' };
    }

    if (isReadable(state)) {
        return { row, result: 'ready', expiresAt: state.expiresAt };
    }
    if (state.availability !== 'archived') return { row, result: 'restoring' };

    try {
        await getS3().send(
            new RestoreObjectCommand({
                Bucket: bucket,
                Key: row.s3Key,
                RestoreRequest: {
                    // The window the request path bought for this row: two days
                    // when the thawed copy only feeds a zip build, seven when
                    // it is the download itself (#424). Pre-#424 rows carry
                    // null and get the default.
                    Days: row.restoreDaysToKeep ?? DEFAULT_RESTORE_DAYS_TO_KEEP,
                    GlacierJobParameters: { Tier: S3_TIER[tier] },
                },
            })
        );
        return { row, result: 'restoring' };
    } catch (error) {
        if (isRestoreAlreadyInProgress(error)) {
            return { row, result: 'restoring' };
        }
        // As loud as the pre-#329 batch-wide throw was: a total restore outage
        // must not be visible only as rows in a DB column. The whole-invocation
        // throw at the end of the handler is what reaches `nexus-worker-errors`.
        console.error(
            `RestoreObject failed for retrieval ${row.retrievalId} (file ${row.fileId}):`,
            error
        );
        return { row, result: 'failed', message: toMessage(error) };
    }
}

/**
 * Apply one row's plan, reporting whether the write landed.
 *
 * Failures to write are swallowed per row for the same reason #329 swallowed
 * them: a failed failure-write must not discard the sibling restores that
 * already fired. The row stays `pending`, which the readiness poll and the 48h
 * stuck-retrieval check both still see — so the caller counts it as errored
 * rather than as the outcome it could not record.
 */
async function applyPlan(
    retrievalRepo: RetrievalRepo,
    plan: RowPlan
): Promise<boolean> {
    // Nothing to write: the row is already `pending`, which is what a restore
    // in flight looks like.
    if (plan.result === 'restoring') return true;

    try {
        if (plan.result === 'ready') {
            await markRetrievalReady(
                retrievalRepo,
                plan.row.retrievalId,
                plan.expiresAt,
                plan.row.restoreDaysToKeep
            );
        } else if (plan.result === 'missing') {
            await markRetrievalMissing(retrievalRepo, plan.row.retrievalId);
        } else {
            await markRetrievalFailed(
                retrievalRepo,
                plan.row.retrievalId,
                plan.message
            );
        }
        return true;
    } catch (error) {
        console.warn(
            `Failed to record ${plan.result} for retrieval ${plan.row.retrievalId}:`,
            error
        );
        return false;
    }
}

/**
 * Start the restores one retrieval request asked for.
 *
 * The fan-out that used to run inside the tRPC mutation (#423). The request
 * path still writes every retrieval row before this job exists, so #329's rule
 * — no `RestoreObject` without a row already behind it — now holds across the
 * whole queue hop rather than across one function call. What moved here is only
 * the part that talks to S3, which is the part that does not fit in a request:
 * the file cap is 10,000, and two S3 round trips per file is not something an
 * HTTP handler can wait for.
 *
 * Idempotent by construction, which matters because SQS delivers at least once:
 * a row whose restore already fired reads back as `restoring` and is left
 * alone, and a duplicate `RestoreObject` that slips through the gap is answered
 * with `RestoreAlreadyInProgress`, which counts as started.
 */
export async function initiateRestore(
    ctx: HandlerContext<'initiate-restore'>
): Promise<void> {
    const { payload, db } = ctx;
    const requestRepo = createRetrievalRequestRepo(db);
    const retrievalRepo = createRetrievalRepo(db);

    const request = await requestRepo.findById(payload.requestId);
    // The request can be gone by the time the job runs (the user was deleted,
    // taking their rows with it). Nothing to do is a completed job, not a retry.
    if (!request) {
        console.warn(
            `initiate-restore: request ${payload.requestId} no longer exists.`
        );
        return;
    }

    const rows = await requestRepo.findPendingRetrievals(payload.requestId);
    if (rows.length === 0) return;

    const bucket = requireEnv('S3_BUCKET');
    const s3Calls = createSemaphore(S3_CONCURRENCY);
    const plans = await Promise.all(
        rows.map((row) => s3Calls.run(() => planRow(row, request.tier, bucket)))
    );

    // Serial, unlike the S3 calls above: one query in flight at a time is what
    // keeps the worker from opening a second pooler connection.
    const summary: InitiateRestoreSummary = {
        planned: plans.length,
        ready: 0,
        restoring: 0,
        missing: 0,
        failed: 0,
        errored: 0,
    };
    for (const plan of plans) {
        const isWritten = await applyPlan(retrievalRepo, plan);
        // A row whose write failed is still `pending`, so counting it as its
        // planned outcome would make this log claim work that did not land.
        if (isWritten) summary[plan.result]++;
        else summary.errored++;
    }

    console.log(
        `initiate-restore ${payload.requestId}:`,
        JSON.stringify(summary)
    );

    // Same escalation rule as the readiness poll: nothing getting through is not
    // a per-row problem, it is S3, IAM, a bad bucket or a dead database, and the
    // `nexus-worker-errors` alarm only ever sees a whole-invocation throw. A
    // missing object is excluded because it is a settled answer, not an outage —
    // the same carve-out `failMissing` earns in the poll. Throwing also puts the
    // message back on the queue, and the handler is idempotent, so the retry
    // costs nothing but the HEADs.
    if (summary.failed + summary.errored === summary.planned) {
        throw new Error(
            `initiate-restore failed for all ${summary.planned} files of request ${payload.requestId}; see the errors above.`
        );
    }
}

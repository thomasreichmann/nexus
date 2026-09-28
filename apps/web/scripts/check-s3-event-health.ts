/**
 * Health check for the webhook rails that share the `webhook_events` table —
 * CloudWatch alarms and Stripe — plus the retrieval and upload sweeps.
 *
 * The S3 lifecycle/restore strand is gone with the rail itself (#416); the
 * retrieval sweep below is now the thing that catches a restore going
 * unobserved, since the worker's poll — not a webhook — marks rows ready.
 *
 * Fails (exit 1) when:
 *   - any CloudWatch webhook event landed in status 'failed' or 'unhandled' in
 *     the last 7 days
 *   - any Stripe webhook event landed in 'failed', 'unhandled', or 'noop' in
 *     the same window (#332). Request-time alerts fire once and are
 *     best-effort; this is what makes a stranded billing event stay visible —
 *     and a stranded upgrade is what leaves a paying user blocked.
 *   - any webhook event from either source has sat in 'received' for over an
 *     hour (#331): the route inserts at 'received' and only moves the row
 *     after dispatch, so a crash in between strands it there
 *   - any retrieval has sat in 'pending'/'in_progress' for over 48 hours
 *     (Deep Archive bulk restores complete within 48h — older is stuck)
 *   - any file has sat in 'uploading' for over 24 hours (#330): the client
 *     abandoned it without calling cleanup, so the row is invisible to every
 *     list and whatever bytes reached S3 are billed but untracked
 *
 * Also reports on thumbnails (#409), without failing the check. A broken
 * thumbnail pipeline degrades every library to icon tiles, which look exactly
 * like "not generated yet", so this leg sends its own alert instead of turning
 * the event-pipeline check red:
 *   - error: most of a recent upload cohort is still 'pending' a day later,
 *     which is what a broken derived bucket or worker looks like (see
 *     sweepThumbnails for why it's a rate, not a count)
 *   - info: recent uploads went 'failed_cold' since the last run. Only a paid
 *     restore heals those, so the daily digest is how a rising trend gets
 *     noticed.
 *
 * Usage:
 *   pnpm -F web check:s3-event-health
 */

import { and, inArray, lt } from 'drizzle-orm';

import { createFileRepo, STALE_UPLOAD_HOURS } from '@nexus/db/repo/files';
import {
    createWebhookRepo,
    type StrandedWebhookEvent,
    type WebhookEvent,
    type WebhookRepo,
} from '@nexus/db/repo/webhooks';
import { retrievals } from '@nexus/db/schema';
import { alerts, getWorkflowRunUrl } from '@/lib/alerts';
import { db } from '@/server/db';

/**
 * How far back the failed/unhandled leg looks. Those rows are history: they
 * record something that already went wrong and was dealt with, so they age
 * out. The stranded leg below is deliberately unbounded — see there.
 */
const FAILED_WEBHOOK_WINDOW_DAYS = 7;

/**
 * How long a row may sit in 'received' before it counts as stranded. Real
 * processing takes seconds; the hour is slack for a row inserted while this
 * check runs, not a guess at how long dispatch takes.
 */
const STUCK_RECEIVED_MINUTES = 60;

const STUCK_RETRIEVAL_HOURS = 48;

// Statuses that need a human: the event did not complete cleanly. 'noop' only
// ever applies to Stripe (#332) — the alarm handler doesn't produce it.
const STRANDED_ALARM_STATUSES: WebhookEvent['status'][] = [
    'failed',
    'unhandled',
];
const STRANDED_STRIPE_STATUSES: WebhookEvent['status'][] = [
    ...STRANDED_ALARM_STATUSES,
    'noop',
];

/** How each source reads in prose. */
const SOURCE_LABELS: Record<WebhookEvent['source'], string> = {
    cloudwatch: 'CloudWatch',
    stripe: 'Stripe',
    // Retired with the S3 rail (#416); no row has been written since. Kept
    // only because the enum value survives for the historical rows.
    sns: 'SNS',
};

/**
 * Lowercase, because this reads mid-sentence in the alert message alongside
 * the other counts. The stdout header capitalizes it at the call site.
 */
function formatStrandedLabel(
    source: WebhookEvent['source'],
    statuses: WebhookEvent['status'][]
): string {
    return `${statuses.join('/')} ${SOURCE_LABELS[source]} webhook event(s) in the last ${FAILED_WEBHOOK_WINDOW_DAYS}d`;
}

/**
 * Queries one strand and prints the count header plus a line per row. Query
 * and header take the status list from the same argument, so the header can't
 * claim a sweep the query didn't do.
 */
async function sweepStrandedWebhooks(
    repo: WebhookRepo,
    source: WebhookEvent['source'],
    statuses: WebhookEvent['status'][],
    createdAfter: Date
): Promise<StrandedWebhookEvent[]> {
    const rows = await repo.findStranded(source, statuses, createdAfter);
    const label = formatStrandedLabel(source, statuses);

    console.log(
        `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${rows.length}`
    );
    for (const event of rows) {
        console.log(
            `  ✗ ${event.createdAt.toISOString()}  ${event.status}  ${event.eventType}  ${event.error ?? '(no error recorded)'}`
        );
    }
    return rows;
}

/**
 * A thumbnail job finishes within minutes, and even one that fails outright
 * has left 'pending' after SQS's three attempts (~36 min). A row still
 * 'pending' this long after upload is never getting a thumbnail.
 */
const STUCK_THUMBNAIL_HOURS = 24;

/**
 * Only uploads from this window count. Rows that predate thumbnails (0016)
 * and seed/fixture rows sit at 'pending' forever with no job behind them;
 * the window lets them age out instead of alarming every night.
 */
const THUMBNAIL_COHORT_DAYS = 7;

/**
 * One poison file is a bad file, not a broken bucket. The alarm needs both a
 * floor and a majority of the cohort before it calls the pipeline broken.
 */
const MIN_STUCK_THUMBNAILS = 3;
const STUCK_THUMBNAIL_SHARE = 0.5;

/** Matches the workflow's daily schedule, so each run reports its own day. */
const FAILED_COLD_DIGEST_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The thumbnail leg (#409). Reads counts, not rows: the question is whether
 * the pipeline as a whole is producing thumbnails, and the per-file detail
 * lives in the worker's logs.
 */
async function sweepThumbnails(): Promise<void> {
    const fileRepo = createFileRepo(db);
    const now = Date.now();

    const cohortStart = new Date(now - THUMBNAIL_COHORT_DAYS * 24 * HOUR_MS);
    const cohort = await fileRepo.countThumbnailStatuses({
        createdAfter: cohortStart,
        createdBefore: new Date(now - STUCK_THUMBNAIL_HOURS * HOUR_MS),
    });
    // 'skipped' rows (non-media, deleted before the job ran) were never going
    // to get a thumbnail, so they're outside the rate either way.
    const eligible =
        cohort.pending + cohort.ready + cohort.failed + cohort.failed_cold;
    const isPipelineStuck =
        cohort.pending >= MIN_STUCK_THUMBNAILS &&
        cohort.pending / eligible >= STUCK_THUMBNAIL_SHARE;

    const failedColdTotal = (await fileRepo.countThumbnailStatuses())
        .failed_cold;
    // No thumbnail-status timestamp exists, so "went failed_cold today" is
    // read off updatedAt, which any later write to the row also bumps. The
    // cohort bound keeps the big one out: a restore of a legacy failed_cold
    // row (0016 marked every archived original) would otherwise count as new.
    const failedColdNew = (
        await fileRepo.countThumbnailStatuses({
            createdAfter: cohortStart,
            updatedAfter: new Date(now - FAILED_COLD_DIGEST_HOURS * HOUR_MS),
        })
    ).failed_cold;

    const stuckLabel = `thumbnail(s) still 'pending' >${STUCK_THUMBNAIL_HOURS}h, of ${eligible} eligible upload(s) from the last ${THUMBNAIL_COHORT_DAYS}d`;
    const failedColdLabel = `upload(s) from the last ${THUMBNAIL_COHORT_DAYS}d went 'failed_cold' in the last ${FAILED_COLD_DIGEST_HOURS}h (${failedColdTotal} failed_cold in all)`;

    console.log(
        `\nThumbnails stuck: ${cohort.pending} ${stuckLabel}${isPipelineStuck ? '  ✗' : ''}`
    );
    console.log(`Thumbnails failed_cold: ${failedColdNew} ${failedColdLabel}`);

    if (!isPipelineStuck && failedColdNew === 0) return;

    const runUrl = getWorkflowRunUrl();
    const context = {
        source: 'check-s3-event-health',
        ...(runUrl && { workflowRun: runUrl }),
    };
    await alerts.send(
        isPipelineStuck
            ? {
                  severity: 'error',
                  title: 'Thumbnail pipeline looks broken',
                  message: `${cohort.pending} ${stuckLabel}. Users see icon tiles where thumbnails should be. Suspect the derived bucket or the worker; the DLQ alarm covers only jobs that throw. Also ${failedColdNew} ${failedColdLabel}.`,
                  context,
              }
            : {
                  severity: 'info',
                  title: 'Thumbnails went failed_cold',
                  message: `${failedColdNew} ${failedColdLabel}. These heal only if the user pays for a restore.`,
                  context,
              }
    );
}

async function main(): Promise<void> {
    let hasFailure = false;

    const failedAfter = new Date(
        Date.now() - FAILED_WEBHOOK_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    const webhookRepo = createWebhookRepo(db);

    const strandedAlarmWebhooks = await sweepStrandedWebhooks(
        webhookRepo,
        'cloudwatch',
        STRANDED_ALARM_STATUSES,
        failedAfter
    );
    if (strandedAlarmWebhooks.length > 0) hasFailure = true;

    const strandedStripeWebhooks = await sweepStrandedWebhooks(
        webhookRepo,
        'stripe',
        STRANDED_STRIPE_STATUSES,
        failedAfter
    );
    if (strandedStripeWebhooks.length > 0) hasFailure = true;

    // No lower bound, unlike the two legs above. A stranded row is an open
    // incident, not history — an event was accepted and never acted on — and
    // nothing re-drives it once the provider's retries are spent. Letting it
    // age out of this query would restore the exact blindness #331 closed,
    // just a week later. Resolve the row to clear the check.
    const stuckReceivedBefore = new Date(
        Date.now() - STUCK_RECEIVED_MINUTES * 60 * 1000
    );
    const stuckReceivedWebhooks =
        await webhookRepo.findStuckAtReceived(stuckReceivedBefore);

    console.log(
        `Webhook events stranded at 'received' >${STUCK_RECEIVED_MINUTES}m: ${stuckReceivedWebhooks.length}`
    );
    for (const event of stuckReceivedWebhooks) {
        console.log(
            `  ✗ ${event.createdAt.toISOString()}  ${event.source}  ${event.eventType}  event=${event.id}`
        );
    }
    if (stuckReceivedWebhooks.length > 0) hasFailure = true;

    const stuckBefore = new Date(
        Date.now() - STUCK_RETRIEVAL_HOURS * 60 * 60 * 1000
    );
    const stuckRetrievals = await db
        .select({
            id: retrievals.id,
            fileId: retrievals.fileId,
            status: retrievals.status,
            tier: retrievals.tier,
            createdAt: retrievals.createdAt,
        })
        .from(retrievals)
        .where(
            and(
                inArray(retrievals.status, ['pending', 'in_progress']),
                lt(retrievals.createdAt, stuckBefore)
            )
        );

    console.log(
        `Retrievals stuck >${STUCK_RETRIEVAL_HOURS}h:                ${stuckRetrievals.length}`
    );
    for (const retrieval of stuckRetrievals) {
        console.log(
            `  ✗ ${retrieval.createdAt.toISOString()}  ${retrieval.status} (${retrieval.tier})  retrieval=${retrieval.id} file=${retrieval.fileId}`
        );
    }
    if (stuckRetrievals.length > 0) hasFailure = true;

    // Same query and threshold `reap:stale-uploads` acts on — this leg reports
    // exactly what that script would clear.
    const staleUploadsBefore = new Date(
        Date.now() - STALE_UPLOAD_HOURS * 60 * 60 * 1000
    );
    const staleUploads =
        await createFileRepo(db).findStaleUploads(staleUploadsBefore);

    console.log(
        `Uploads stuck >${STALE_UPLOAD_HOURS}h:                   ${staleUploads.length}`
    );
    for (const file of staleUploads) {
        console.log(
            `  ✗ ${file.createdAt.toISOString()}  ${file.size}B  file=${file.id} user=${file.userId} key=${file.s3Key}`
        );
    }
    if (staleUploads.length > 0) hasFailure = true;

    if (hasFailure) {
        console.log('\nCheck failed: event pipeline needs attention.');
        process.exitCode = 1;

        // The exit-1 (and its workflow-failure email) stays as the dead-man
        // backup for the check itself; this pushes the findings where they
        // get seen (#288).
        const runUrl = getWorkflowRunUrl();
        await alerts.send({
            severity: 'error',
            // Titled for what it covers; the filename still says S3, and now
            // covers even less of it. #375 owns the rename.
            title: 'Event pipeline health check failed',
            message: `${strandedAlarmWebhooks.length} ${formatStrandedLabel('cloudwatch', STRANDED_ALARM_STATUSES)}; ${strandedStripeWebhooks.length} ${formatStrandedLabel('stripe', STRANDED_STRIPE_STATUSES)}; ${stuckReceivedWebhooks.length} webhook event(s) stranded at 'received' >${STUCK_RECEIVED_MINUTES}m; ${stuckRetrievals.length} retrieval(s) stuck >${STUCK_RETRIEVAL_HOURS}h; ${staleUploads.length} upload(s) stuck >${STALE_UPLOAD_HOURS}h.`,
            context: {
                source: 'check-s3-event-health',
                ...(runUrl && { workflowRun: runUrl }),
            },
        });
    } else {
        console.log('\nAll checks passed.');
    }

    // Last, so a throw here can't suppress the event-pipeline alert above. It
    // still aborts the run (exit 1) through main's catch.
    await sweepThumbnails();
}

main()
    .catch((err) => {
        console.error('Health check aborted:', err);
        process.exitCode = 1;
    })
    // The pooled connection keeps the event loop alive; close it so the
    // script exits instead of hanging after the summary prints.
    .finally(() => db.$client.end());

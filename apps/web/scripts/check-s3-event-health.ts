/**
 * Health check for the S3 event pipeline (SNS webhook → DB side effects), plus
 * the Stripe webhook strand of the same `webhook_events` table.
 *
 * Fails (exit 1) when:
 *   - any SNS webhook event landed in status 'failed' or 'unhandled' in the
 *     last 7 days (allowlisted expected events stay 'processed', so routine
 *     ObjectRestore:Post deliveries don't trip this)
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
 * Tier drift is covered separately by `backfill:storage-tier --check`; the
 * two together are the post-deploy watch for #278 (see #285).
 *
 * Usage:
 *   pnpm -F web check:s3-event-health
 *   pnpm -F web check:s3-event-health -- --since 2026-07-05T00:00:00Z
 *
 * With --since, prints `handled_events_since=<n>` — the count of processed
 * handled-type S3 events after that time. CI uses it to detect that the
 * first real post-deploy event arrived and post the success comment.
 */

import { and, count, eq, gte, inArray, lt } from 'drizzle-orm';

import { alerts, getWorkflowRunUrl } from '@/lib/alerts';
import { db } from '@/server/db';
import { s3RestoreService } from '@/server/services/s3-restore';
import { createFileRepo, STALE_UPLOAD_HOURS } from '@nexus/db/repo/files';
import {
    createWebhookRepo,
    type StrandedWebhookEvent,
    type WebhookEvent,
} from '@nexus/db/repo/webhooks';
import { retrievals, webhookEvents } from '@nexus/db/schema';

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
// ever applies to Stripe (#332) — the SNS handlers don't produce it.
const STRANDED_SNS_STATUSES: WebhookEvent['status'][] = ['failed', 'unhandled'];
const STRANDED_STRIPE_STATUSES: WebhookEvent['status'][] = [
    ...STRANDED_SNS_STATUSES,
    'noop',
];

/**
 * Prints the count header plus one line per row, naming the exact statuses
 * swept so the header can't drift from what was queried.
 */
function reportStrandedWebhooks(
    source: WebhookEvent['source'],
    statuses: WebhookEvent['status'][],
    rows: StrandedWebhookEvent[]
): void {
    console.log(`${strandedLabel(source, statuses)}: ${rows.length}`);
    for (const event of rows) {
        console.log(
            `  ✗ ${event.createdAt.toISOString()}  ${event.status}  ${event.eventType}  ${event.error ?? '(no error recorded)'}`
        );
    }
}

function strandedLabel(
    source: WebhookEvent['source'],
    statuses: WebhookEvent['status'][]
): string {
    return `${statuses.join('/')} ${source} webhook events (last ${FAILED_WEBHOOK_WINDOW_DAYS}d)`;
}

function parseSinceArg(): Date | null {
    const index = process.argv.indexOf('--since');
    if (index === -1) return null;
    const raw = process.argv[index + 1];
    const since = raw ? new Date(raw) : null;
    if (!since || Number.isNaN(since.getTime())) {
        throw new Error(`--since requires a valid ISO date, got: ${raw}`);
    }
    return since;
}

async function main(): Promise<void> {
    const since = parseSinceArg();
    let hasFailure = false;

    const failedAfter = new Date(
        Date.now() - FAILED_WEBHOOK_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    const webhookRepo = createWebhookRepo(db);

    const failedWebhooks = await webhookRepo.findStranded(
        'sns',
        STRANDED_SNS_STATUSES,
        failedAfter
    );
    reportStrandedWebhooks('sns', STRANDED_SNS_STATUSES, failedWebhooks);
    if (failedWebhooks.length > 0) hasFailure = true;

    const strandedStripeWebhooks = await webhookRepo.findStranded(
        'stripe',
        STRANDED_STRIPE_STATUSES,
        failedAfter
    );
    reportStrandedWebhooks(
        'stripe',
        STRANDED_STRIPE_STATUSES,
        strandedStripeWebhooks
    );
    if (strandedStripeWebhooks.length > 0) hasFailure = true;

    // Unscoped by source, unlike the two legs above: a Stripe strand is the
    // same silent hole as an SNS one.
    //
    // No lower bound, unlike the failed leg. A stranded row is an open
    // incident, not history — an event was accepted and never acted on — and
    // nothing re-drives it once the provider's retries are spent. Letting it
    // age out of this query would restore the exact blindness #331 closed,
    // just a week later. Resolve the row to clear the check.
    const stuckReceivedBefore = new Date(
        Date.now() - STUCK_RECEIVED_MINUTES * 60 * 1000
    );
    const stuckReceivedWebhooks = await db
        .select({
            id: webhookEvents.id,
            source: webhookEvents.source,
            eventType: webhookEvents.eventType,
            createdAt: webhookEvents.createdAt,
        })
        .from(webhookEvents)
        .where(
            and(
                eq(webhookEvents.status, 'received'),
                lt(webhookEvents.createdAt, stuckReceivedBefore)
            )
        );

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

    if (since) {
        const [handled] = await db
            .select({ count: count() })
            .from(webhookEvents)
            .where(
                and(
                    eq(webhookEvents.source, 'sns'),
                    eq(webhookEvents.status, 'processed'),
                    inArray(
                        webhookEvents.eventType,
                        s3RestoreService.handledEventTypes
                    ),
                    gte(webhookEvents.createdAt, since)
                )
            );
        console.log(
            `Handled-type events processed since ${since.toISOString()}: ${handled?.count ?? 0}`
        );
        console.log(`handled_events_since=${handled?.count ?? 0}`);
    }

    if (hasFailure) {
        console.log('\nCheck failed: event pipeline needs attention.');
        process.exitCode = 1;

        // The exit-1 (and its workflow-failure email) stays as the dead-man
        // backup for the check itself; this pushes the findings where they
        // get seen (#288).
        const runUrl = getWorkflowRunUrl();
        await alerts.send({
            severity: 'error',
            // Titled for what it covers; the filename still says S3 (#375).
            title: 'Event pipeline health check failed',
            message: `${failedWebhooks.length} ${strandedLabel('sns', STRANDED_SNS_STATUSES)}; ${strandedStripeWebhooks.length} ${strandedLabel('stripe', STRANDED_STRIPE_STATUSES)}; ${stuckReceivedWebhooks.length} webhook event(s) stranded at 'received' >${STUCK_RECEIVED_MINUTES}m; ${stuckRetrievals.length} retrieval(s) stuck >${STUCK_RETRIEVAL_HOURS}h; ${staleUploads.length} upload(s) stuck >${STALE_UPLOAD_HOURS}h.`,
            context: {
                source: 'check-s3-event-health',
                ...(runUrl && { workflowRun: runUrl }),
            },
        });
    } else {
        console.log('\nAll checks passed.');
    }
}

main()
    .catch((err) => {
        console.error('Health check aborted:', err);
        process.exitCode = 1;
    })
    // The pooled connection keeps the event loop alive; close it so the
    // script exits instead of hanging after the summary prints.
    .finally(() => db.$client.end());

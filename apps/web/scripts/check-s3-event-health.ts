/**
 * Health check for the S3 event pipeline (SNS webhook → DB side effects).
 *
 * Fails (exit 1) when:
 *   - any SNS webhook event landed in status 'failed' or 'unhandled' in the
 *     last 7 days (allowlisted expected events stay 'processed', so routine
 *     ObjectRestore:Post deliveries don't trip this)
 *   - any retrieval has sat in 'pending'/'in_progress' for over 48 hours
 *     (Deep Archive bulk restores complete within 48h — older is stuck)
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
import { retrievals, webhookEvents } from '@nexus/db/schema';

const FAILED_WEBHOOK_WINDOW_DAYS = 7;
const STUCK_RETRIEVAL_HOURS = 48;

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
    const failedWebhooks = await db
        .select({
            id: webhookEvents.id,
            eventType: webhookEvents.eventType,
            status: webhookEvents.status,
            error: webhookEvents.error,
            createdAt: webhookEvents.createdAt,
        })
        .from(webhookEvents)
        .where(
            and(
                eq(webhookEvents.source, 'sns'),
                inArray(webhookEvents.status, ['failed', 'unhandled']),
                gte(webhookEvents.createdAt, failedAfter)
            )
        );

    console.log(
        `Failed/unhandled SNS webhook events (last ${FAILED_WEBHOOK_WINDOW_DAYS}d): ${failedWebhooks.length}`
    );
    for (const event of failedWebhooks) {
        console.log(
            `  ✗ ${event.createdAt.toISOString()}  ${event.status}  ${event.eventType}  ${event.error ?? '(no error recorded)'}`
        );
    }
    if (failedWebhooks.length > 0) hasFailure = true;

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
        console.log('\nCheck failed: S3 event pipeline needs attention.');
        process.exitCode = 1;

        // The exit-1 (and its workflow-failure email) stays as the dead-man
        // backup for the check itself; this pushes the findings where they
        // get seen (#288).
        const runUrl = getWorkflowRunUrl();
        await alerts.send({
            severity: 'error',
            title: 'S3 event pipeline health check failed',
            message: `${failedWebhooks.length} failed/unhandled SNS webhook event(s) in the last ${FAILED_WEBHOOK_WINDOW_DAYS}d; ${stuckRetrievals.length} retrieval(s) stuck >${STUCK_RETRIEVAL_HOURS}h.`,
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

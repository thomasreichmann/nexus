import { createDb, type DB } from '@nexus/db';
import { createJobRepo, type SqsMessageBody } from '@nexus/db/repo/jobs';
import { flushWorkerAnalytics } from './analytics';
import { pollRetrievals } from './pollRetrievals';
import { getHandler } from './registry';
import type { SQSEvent } from 'aws-lambda';

// Register all job handlers
import './handlers/index';

// Env comes from the Lambda function configuration (set per environment),
// not Vercel — see README. Cached in module scope for warm-container reuse.
let db: DB | undefined;

function getDb(): DB {
    if (!db) {
        const url = process.env.DATABASE_URL;
        if (!url) {
            throw new Error(
                'DATABASE_URL is not set. Configure it on the Lambda function (see apps/worker/README.md).'
            );
        }
        db = createDb(url, { prepare: false });
    }
    return db;
}

export async function processRecord(
    db: DB,
    record: SQSEvent['Records'][number]
): Promise<void> {
    const message: SqsMessageBody = JSON.parse(record.body);
    const { jobId, type, payload } = message;

    const jobRepo = createJobRepo(db);
    await jobRepo.markProcessing(jobId);

    try {
        const jobHandler = getHandler(type);
        await jobHandler({ jobId, payload, db });

        await jobRepo.update(jobId, {
            status: 'completed',
            completedAt: new Date(),
        });
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        await jobRepo.update(jobId, {
            status: 'failed',
            error: errorMessage,
        });

        // Re-throw so SQS retries / sends to DLQ
        throw error;
    }
}

/**
 * The scheduled retrieval poll has no payload, so EventBridge delivers a bare
 * object with no `Records` (see infra/terraform/scheduler.tf).
 */
function isSqsEvent(event: WorkerEvent): event is SQSEvent {
    return Array.isArray((event as SQSEvent).Records);
}

/** Anything EventBridge sends on the schedule; the payload is unused. */
type ScheduledEvent = Record<string, unknown>;

export type WorkerEvent = SQSEvent | ScheduledEvent;

/**
 * One Lambda, two triggers: SQS jobs and the 15-minute retrieval poll.
 *
 * They share a function because they share a warm container and its single DB
 * connection, and because the split that would matter — isolating the queue's
 * concurrency — is #385's, not this one's.
 */
export async function handler(event: WorkerEvent): Promise<void> {
    // `finally`, so a failing record still flushes: the events captured before
    // it threw are as real as the ones on the happy path, and Lambda freezes
    // the container either way. See flushWorkerAnalytics for why the batch
    // doesn't drain on its own.
    try {
        if (!isSqsEvent(event)) {
            const summary = await pollRetrievals(getDb());
            console.log('Retrieval poll complete:', JSON.stringify(summary));
            return;
        }

        for (const record of event.Records) {
            await processRecord(getDb(), record);
        }
    } finally {
        await flushWorkerAnalytics();
    }
}

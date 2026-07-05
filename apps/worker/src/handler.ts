import type { SQSEvent } from 'aws-lambda';
import { createDb, type DB } from '@nexus/db';
import { createJobRepo, type SqsMessageBody } from '@nexus/db/repo/jobs';
import { getHandler } from './registry';

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

export async function handler(event: SQSEvent): Promise<void> {
    for (const record of event.Records) {
        await processRecord(getDb(), record);
    }
}

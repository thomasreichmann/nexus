import type { SQSEvent } from 'aws-lambda';
import {
    createDb,
    markJobProcessing,
    updateJob,
    type DB,
    type SqsMessageBody,
} from '@nexus/db';
import { getHandler } from './registry';

// Register all job handlers
import './handlers/index';

const db = createDb(process.env.DATABASE_URL!, { prepare: false });

export async function processRecord(
    db: DB,
    record: SQSEvent['Records'][number]
): Promise<void> {
    const message: SqsMessageBody = JSON.parse(record.body);
    const { jobId, type, payload } = message;

    await markJobProcessing(db, jobId);

    try {
        const jobHandler = getHandler(type);
        await jobHandler({ jobId, payload, db });

        await updateJob(db, jobId, {
            status: 'completed',
            completedAt: new Date(),
        });
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        await updateJob(db, jobId, {
            status: 'failed',
            error: errorMessage,
        });

        // Re-throw so SQS retries / sends to DLQ
        throw error;
    }
}

export async function handler(event: SQSEvent): Promise<void> {
    for (const record of event.Records) {
        await processRecord(db, record);
    }
}

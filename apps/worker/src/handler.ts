import type { SQSEvent } from 'aws-lambda';
import { createDb, type DB } from '@nexus/db';
import { createJobRepo, type SqsMessageBody } from '@nexus/db/repo/jobs';
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
        await processRecord(db, record);
    }
}

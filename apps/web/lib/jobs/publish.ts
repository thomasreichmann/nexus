import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { client, queueUrl } from './client';
import type { JobInput, SqsMessageBody } from './types';
import { insertJob, type Job } from '@/server/db/repositories/jobs';
import type { DB } from '@/server/db';

/**
 * Publish a background job: inserts a DB record and sends an SQS message.
 *
 * The DB insert happens first so the record exists before the message is sent.
 * If SQS fails, the DB record remains with status 'pending' (safe to retry).
 */
export async function publish(db: DB, input: JobInput): Promise<Job> {
    const job = await insertJob(db, {
        type: input.type,
        payload: input.payload,
    });

    const messageBody: SqsMessageBody = {
        jobId: job.id,
        type: input.type,
        payload: input.payload,
    };

    await client.send(
        new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(messageBody),
        })
    );

    return job;
}

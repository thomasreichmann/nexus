import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DB } from '@nexus/db';
import {
    createJobRepo,
    type Job,
    type JobInput,
    type SqsMessageBody,
} from '@nexus/db/repo/jobs';
import { client, queueUrl } from './client';

/** Send an SQS message for a job. Used by publish() and retry flows. */
export async function sendToQueue(body: SqsMessageBody): Promise<void> {
    await client.send(
        new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(body),
        })
    );
}

/**
 * Publish a background job: inserts a DB record and sends an SQS message.
 *
 * The DB insert happens first so the record exists before the message is sent.
 * If SQS fails, the DB record remains with status 'pending' (safe to retry).
 */
export async function publish(db: DB, input: JobInput): Promise<Job> {
    const jobRepo = createJobRepo(db);
    const job = await jobRepo.insert({
        type: input.type,
        payload: input.payload,
    });

    await sendToQueue({
        jobId: job.id,
        type: input.type,
        payload: input.payload,
    });

    return job;
}

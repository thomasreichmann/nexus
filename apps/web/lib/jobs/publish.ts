import { SendMessageCommand } from '@aws-sdk/client-sqs';
import {
    createJobRepo,
    queueFor,
    type Job,
    type JobInput,
    type SqsMessageBody,
} from '@nexus/db/repo/jobs';
import { client, queueUrl, zipQueueUrl } from './client';
import type { DB } from '@nexus/db';

/**
 * Send an SQS message for a job. Used by publish() and retry flows.
 *
 * The queue is chosen by type, never fixed: both worker Lambdas register every
 * handler, so the queue is the only thing deciding which one runs a job. The
 * admin retry re-publishes whatever type it finds on a failed row, and a zip
 * build sent to the general queue would be picked up by the 120s worker and
 * time straight back into the DLQ.
 */
export async function sendToQueue(body: SqsMessageBody): Promise<void> {
    await client.send(
        new SendMessageCommand({
            QueueUrl: queueUrlFor(body.type),
            MessageBody: JSON.stringify(body),
        })
    );
}

function queueUrlFor(type: SqsMessageBody['type']): string {
    if (queueFor(type) !== 'zip') return queueUrl;
    if (!zipQueueUrl) {
        throw new Error(
            `SQS_ZIP_QUEUE_URL is not set, so a ${type} job cannot be published. Set it from the terraform output.`
        );
    }
    return zipQueueUrl;
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

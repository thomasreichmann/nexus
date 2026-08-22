import { SendMessageCommand } from '@aws-sdk/client-sqs';
import {
    createJobRepo,
    type Job,
    type JobInput,
    type SqsMessageBody,
} from '@nexus/db/repo/jobs';
import { getSqs, requireEnv } from './aws';
import type { DB } from '@nexus/db';

/**
 * Publish a background job from inside the worker.
 *
 * The twin of `apps/web/lib/jobs/publish.ts` — same contract (DB row first,
 * then the SQS message, so a send failure leaves a retryable `pending` row),
 * different client construction. The worker builds its clients from Lambda env
 * rather than from the app's validated `env` module, which is why this isn't
 * shared; the job repo and the message type already are.
 *
 * The worker publishes as well as consumes because the retrieval poll can
 * discover work — a `failed_cold` thumbnail whose original just became
 * readable — that belongs on the queue rather than inline in the poll.
 */
export async function enqueueJob(db: DB, input: JobInput): Promise<Job> {
    const jobRepo = createJobRepo(db);
    const job = await jobRepo.insert({
        type: input.type,
        payload: input.payload,
    });

    const body: SqsMessageBody = {
        jobId: job.id,
        type: input.type,
        payload: input.payload,
    };

    await getSqs().send(
        new SendMessageCommand({
            QueueUrl: requireEnv('SQS_QUEUE_URL'),
            MessageBody: JSON.stringify(body),
        })
    );

    return job;
}

import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
    ChangeMessageVisibilityCommand,
    DeleteMessageCommand,
    ReceiveMessageCommand,
    type Message,
} from '@aws-sdk/client-sqs';
import { createDb, type DB } from '@nexus/db';
import { backgroundJobs } from '@nexus/db/schema';
import { client } from './client';
import { publish } from './publish';
import type { Job } from '@nexus/db/repo/jobs';

const db: DB = createDb(process.env.DATABASE_URL!);
const createdJobs: Job[] = [];

afterAll(async () => {
    for (const job of createdJobs) {
        await db.delete(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    }
});

// Set only by ci.yml, on fork PRs: GitHub withholds repo secrets from them, so
// there are no AWS credentials to publish with. The workflow prints a warning
// annotation on the run. Never set it locally; a missing queue URL there
// should fail, not skip.
const isAwsUnavailable = process.env.INTEGRATION_SKIP_AWS === '1';

describe.skipIf(isAwsUnavailable)('jobs.publish() integration', () => {
    it('inserts a pending row and sends that row as the SQS message body', async () => {
        const testQueueUrl = requireTestQueueUrl();

        const job = await publish(
            db,
            {
                type: 'delete-account',
                payload: { userId: 'integration-test-user' },
            },
            { queueUrl: testQueueUrl }
        );
        createdJobs.push(job);

        expect(job).toMatchObject({
            type: 'delete-account',
            status: 'pending',
            payload: { userId: 'integration-test-user' },
        });
        // Nothing consumes the test queue, so the row can't have moved on.
        const stored = await db.query.backgroundJobs.findFirst({
            where: eq(backgroundJobs.id, job.id),
        });
        expect(stored).toEqual(job);

        const message = await receiveMessageFor(testQueueUrl, job.id);
        await client.send(
            new DeleteMessageCommand({
                QueueUrl: testQueueUrl,
                ReceiptHandle: message.ReceiptHandle,
            })
        );
        expect(JSON.parse(message.Body!)).toEqual({
            jobId: job.id,
            type: 'delete-account',
            payload: { userId: 'integration-test-user' },
        });
    });
});

/**
 * The consumer-less dev queue (infra/terraform/sqs.tf). Never SQS_QUEUE_URL:
 * the deployed worker polls that one, and this job's handler is a stub that
 * throws, failing every real job in its batch (#442).
 */
function requireTestQueueUrl(): string {
    const testQueueUrl = process.env.SQS_INTEGRATION_TEST_QUEUE_URL;
    if (!testQueueUrl) {
        throw new Error(
            'SQS_INTEGRATION_TEST_QUEUE_URL is not set. Add the dev Terraform output sqs_integration_test_queue_url to apps/web/.env.local.'
        );
    }
    const consumedQueues = [
        process.env.SQS_QUEUE_URL,
        process.env.SQS_ZIP_QUEUE_URL,
    ];
    if (consumedQueues.some((url) => url?.trim() === testQueueUrl.trim())) {
        throw new Error(
            'SQS_INTEGRATION_TEST_QUEUE_URL points at a queue a worker consumes.'
        );
    }
    return testQueueUrl;
}

/**
 * Other runs (other checkouts, CI) share the test queue, so a receive can pick
 * up their messages too. Those go straight back (visibility 0) so their own
 * receive isn't stalled behind ours.
 */
async function receiveMessageFor(
    queueUrl: string,
    jobId: string
): Promise<Message> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const { Messages = [] } = await client.send(
            new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: 10,
                WaitTimeSeconds: 2,
                VisibilityTimeout: 30,
            })
        );
        const ours = Messages.find((message) => parseJobId(message) === jobId);
        await Promise.all(
            Messages.filter((message) => message !== ours).map((message) =>
                client.send(
                    new ChangeMessageVisibilityCommand({
                        QueueUrl: queueUrl,
                        ReceiptHandle: message.ReceiptHandle,
                        VisibilityTimeout: 0,
                    })
                )
            )
        );
        if (ours) return ours;
    }
    throw new Error(
        `No message for job ${jobId} arrived on ${queueUrl} within 10s`
    );
}

function parseJobId(message: Message): unknown {
    try {
        return (JSON.parse(message.Body ?? '') as { jobId?: unknown }).jobId;
    } catch {
        return undefined;
    }
}

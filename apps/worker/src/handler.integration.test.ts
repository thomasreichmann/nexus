import { vi } from 'vitest';
import { findJob, type Job } from '@nexus/db/test-db';
import { it, describe, expect } from '@nexus/db/test-db/integration';

// The real handlers reach S3, SES and PostHog. Each test registers its own
// handler for the job type instead, so the only thing faked is the job's work:
// the job row is real, and so is every status write processRecord makes.
vi.mock('./handlers/index', () => ({}));

import { processRecord } from './handler';
import { registerHandler } from './registry';
import type { SQSRecord } from 'aws-lambda';

/** The SQS delivery of `job`, shaped the way jobs.publish sends it. */
function sqsRecordFor(job: Job): SQSRecord {
    return {
        messageId: 'msg-1',
        receiptHandle: 'receipt-1',
        body: JSON.stringify({
            jobId: job.id,
            type: job.type,
            payload: job.payload,
        }),
        attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'sender',
            ApproximateFirstReceiveTimestamp: '1234567890',
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test',
        awsRegion: 'us-east-1',
    };
}

// Sequential on purpose: the handler registry is module state, and each test
// installs its own `delete-account` handler.
describe('processRecord', () => {
    it('runs the job’s handler, and marks the job completed only after it returns', async ({
        db,
        createJob,
    }) => {
        const job = await createJob({
            type: 'delete-account',
            payload: { userId: 'user-to-delete' },
        });
        let statusWhileRunning: string | undefined;
        const handler = vi.fn(async () => {
            statusWhileRunning = (await findJob(db, job.id))?.status;
        });
        registerHandler('delete-account', handler);

        await processRecord(db, sqsRecordFor(job));

        expect(handler).toHaveBeenCalledExactlyOnceWith({
            jobId: job.id,
            payload: { userId: 'user-to-delete' },
            db,
        });
        expect(statusWhileRunning).toBe('processing');
        const stored = await findJob(db, job.id);
        expect(stored).toMatchObject({ status: 'completed', error: null });
        expect(stored?.completedAt).toBeInstanceOf(Date);
    });

    it('marks the job failed with the handler’s error, and rethrows so SQS retries', async ({
        db,
        createJob,
    }) => {
        const job = await createJob({ type: 'delete-account' });
        registerHandler('delete-account', async () => {
            throw new Error('S3 unavailable');
        });

        await expect(processRecord(db, sqsRecordFor(job))).rejects.toThrow(
            'S3 unavailable'
        );

        expect(await findJob(db, job.id)).toMatchObject({
            status: 'failed',
            error: 'S3 unavailable',
            completedAt: null,
        });
    });
});

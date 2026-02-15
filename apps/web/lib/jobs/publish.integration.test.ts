import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, backgroundJobs, type DB, type Job } from '@nexus/db';
import { publish } from './publish';

const db: DB = createDb(process.env.DATABASE_URL!);
const createdJobs: Job[] = [];

afterAll(async () => {
    for (const job of createdJobs) {
        await db.delete(backgroundJobs).where(eq(backgroundJobs.id, job.id));
    }
});

describe('jobs.publish() integration', () => {
    it('inserts a DB record and publishes to SQS without error', async () => {
        const job = await publish(db, {
            type: 'delete-account',
            payload: { userId: 'integration-test-user' },
        });
        createdJobs.push(job);

        expect(job.id).toBeDefined();
        expect(job.type).toBe('delete-account');
        expect(job.status).toBe('pending');
        expect(job.payload).toEqual({ userId: 'integration-test-user' });

        const found = await db.query.backgroundJobs.findFirst({
            where: eq(backgroundJobs.id, job.id),
        });

        expect(found).toBeDefined();
        expect(found!.status).toBe('pending');
    });
});

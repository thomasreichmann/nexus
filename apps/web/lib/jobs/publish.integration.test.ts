import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, type DB } from '@nexus/db';
import { backgroundJobs } from '@nexus/db/schema';
import type { Job } from '@nexus/db/repo/jobs';
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

        // Only assert on what publish() owns: the row exists with the inserted
        // fields. The live dev worker may have already consumed the message and
        // transitioned status, so re-asserting 'pending' here races it (#262);
        // the returned row above already proves the insert used 'pending'.
        expect(found).toBeDefined();
        expect(found!.type).toBe('delete-account');
        expect(found!.payload).toEqual({ userId: 'integration-test-user' });
    });
});

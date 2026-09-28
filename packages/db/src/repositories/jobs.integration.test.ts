import { it, expect, describe } from '../test-db/integration';
import { createNewJobFixture, deleteJob, findJob } from '../test-db';
import { createJobRepo, type Job } from './jobs';

// Both queries are global, and the dev database is shared with e2e runs that
// write jobs. Assertions are scoped to this test's rows (findMany) or to the
// change this test made (countByStatus).
describe('jobs repository', () => {
    it('findMany filters the page and the total by status', async ({
        db,
        createJob,
    }) => {
        const repo = createJobRepo(db);
        const failed = await createJob({ status: 'failed' });
        const pending = await createJob({ status: 'pending' });

        const all = await repo.findMany({ limit: 50, offset: 0 });
        const onlyFailed = await repo.findMany({
            limit: 50,
            offset: 0,
            status: 'failed',
        });

        const ids = (jobs: Job[]) => jobs.map((j) => j.id);
        expect(ids(all.jobs)).toEqual(
            expect.arrayContaining([failed.id, pending.id])
        );
        expect(ids(onlyFailed.jobs)).toContain(failed.id);
        expect(ids(onlyFailed.jobs)).not.toContain(pending.id);
        expect(onlyFailed.jobs.every((j) => j.status === 'failed')).toBe(true);
        // At least this test's pending job is outside the filtered count.
        expect(onlyFailed.total).toBeLessThan(all.total);
    });

    // The count is table-wide, and other writers move jobs between statuses
    // while it runs: e2e uploads, and the worker tier's processRecord test in
    // parallel with this one. One REPEATABLE READ snapshot sees only this
    // test's inserts between the two counts.
    it('countByStatus counts each status', async ({ db }) => {
        const { before, after, ids } = await db.transaction(
            async (tx) => {
                const repo = createJobRepo(tx);
                const before = await repo.countByStatus();
                const ids: string[] = [];
                for (const status of [
                    'processing',
                    'failed',
                    'failed',
                ] as const) {
                    ids.push(
                        (await repo.insert(createNewJobFixture({ status }))).id
                    );
                }
                return { before, after: await repo.countByStatus(), ids };
            },
            { isolationLevel: 'repeatable read' }
        );
        await Promise.all(ids.map((id) => deleteJob(db, id)));

        expect(after.processing - before.processing).toBe(1);
        expect(after.failed - before.failed).toBe(2);
    });

    it('update writes to that job only, and returns undefined for a missing one', async ({
        db,
        createJob,
    }) => {
        const repo = createJobRepo(db);
        const target = await createJob();
        const bystander = await createJob();

        const updated = await repo.update(target.id, {
            status: 'failed',
            error: 'boom',
        });

        expect(updated).toMatchObject({ status: 'failed', error: 'boom' });
        expect((await findJob(db, bystander.id))?.status).toBe('pending');
        expect(
            await repo.update(crypto.randomUUID(), { status: 'failed' })
        ).toBeUndefined();
    });

    it('markProcessing claims the job and counts the attempt', async ({
        db,
        createJob,
    }) => {
        const repo = createJobRepo(db);
        const job = await createJob({ attempts: 2 });

        await repo.markProcessing(job.id);

        const stored = await findJob(db, job.id);
        expect(stored).toMatchObject({ status: 'processing', attempts: 3 });
        expect(stored?.startedAt).toBeInstanceOf(Date);
    });
});

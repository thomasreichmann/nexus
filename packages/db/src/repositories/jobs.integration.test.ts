import { it as base, expect, describe } from '../test-db/integration';
import { createNewJobFixture, deleteJob, findJob } from '../test-db';
import { createJobRepo, type NewJob, type Job } from './jobs';

// `background_jobs` has no user to cascade from, so the jobs a test creates
// go through this fixture and are deleted after it. A leftover one shows up in
// the admin jobs table and crowds out e2e's seeded rows (#419).
const it = base.extend<{
    createJob: (overrides?: Partial<NewJob>) => Promise<Job>;
}>({
    createJob: async ({ db }, use) => {
        const ids: string[] = [];
        await use(async (overrides) => {
            const job = await createJobRepo(db).insert(
                createNewJobFixture(overrides)
            );
            ids.push(job.id);
            return job;
        });
        await Promise.all(ids.map((id) => deleteJob(db, id)));
    },
});

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

    it('countByStatus counts each status', async ({ db, createJob }) => {
        const repo = createJobRepo(db);
        const before = await repo.countByStatus();

        await createJob({ status: 'processing' });
        await createJob({ status: 'failed' });
        await createJob({ status: 'failed' });

        const after = await repo.countByStatus();
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

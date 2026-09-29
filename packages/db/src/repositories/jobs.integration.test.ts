import {
    it,
    expect,
    describe,
    inRolledBackTransaction,
} from '../test-db/integration';
import { createNewJobFixture, deleteJob, findJob } from '../test-db';
import { createJobRepo, type Job } from './jobs';

// Rows dated after every real one are the first page of the newest-first
// admin table, whatever else is in there.
const AFTER_ANY_REAL_ROW = new Date('2100-01-01T00:00:00Z').getTime();
const newest = (rank: number) => new Date(AFTER_ANY_REAL_ROW - rank * 1000);

// Both queries are global, and the dev database is shared with e2e runs that
// write jobs. Assertions are scoped to this test's rows (findMany) or to the
// change this test made (countByStatus).
describe('jobs repository', () => {
    it('findMany filters the page and the total by status', async ({
        db,
        createJob,
    }) => {
        const failed = await createJob({ status: 'failed' });
        const pending = await createJob({ status: 'pending' });

        // One snapshot for both pages: a failed job another run commits
        // between two separate reads would put more in the filtered total
        // than in the whole one.
        const { all, onlyFailed } = await db.transaction(
            async (tx) => {
                const repo = createJobRepo(tx);
                return {
                    all: await repo.findMany({ limit: 50, offset: 0 }),
                    onlyFailed: await repo.findMany({
                        limit: 50,
                        offset: 0,
                        status: 'failed',
                    }),
                };
            },
            { isolationLevel: 'repeatable read' }
        );

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

    // The admin jobs table pages through this. Another run of this test would
    // seed the same dates, so the rows are never committed.
    it('findMany pages newest first', ({ db }) =>
        inRolledBackTransaction(db, async (tx) => {
            const repo = createJobRepo(tx);
            const byRank: Job[] = [];
            // One more row than the offset and the page cover. Inserted
            // oldest first, so on an empty database a query that ignored the
            // order would page through them oldest first.
            for (const rank of [3, 2, 1, 0]) {
                byRank[rank] = await repo.insert(
                    createNewJobFixture({ createdAt: newest(rank) })
                );
            }

            const page = await repo.findMany({ limit: 2, offset: 1 });

            expect(page.jobs.map((j) => j.id)).toEqual([
                byRank[1]!.id,
                byRank[2]!.id,
            ]);
        }));

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

    // The worker runs this for every SQS record: it must claim that job and
    // leave every other one alone.
    it('markProcessing claims the job and counts the attempt, and no other job', async ({
        db,
        createJob,
    }) => {
        const repo = createJobRepo(db);
        const job = await createJob({ attempts: 2 });
        const bystander = await createJob();

        await repo.markProcessing(job.id);

        const stored = await findJob(db, job.id);
        expect(stored).toMatchObject({ status: 'processing', attempts: 3 });
        expect(stored?.startedAt).toBeInstanceOf(Date);
        expect(await findJob(db, bystander.id)).toEqual(bystander);
    });
});

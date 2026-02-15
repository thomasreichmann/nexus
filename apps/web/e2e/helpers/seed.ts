import {
    insertJob,
    deleteJob,
    countJobsByStatus,
    type DbJob,
    type JobCounts,
} from './db';

export { countJobsByStatus };
export type { DbJob, JobCounts };

export interface SeedJobsOptions {
    pending?: number;
    processing?: number;
    completed?: number;
    failed?: number;
}

/**
 * Seed background jobs in the database with specified statuses.
 * Returns all created jobs for cleanup.
 */
export async function seedJobs(options: SeedJobsOptions): Promise<DbJob[]> {
    const jobs: DbJob[] = [];
    const now = new Date();

    const entries = Object.entries(options) as [DbJob['status'], number][];
    for (const [status, count] of entries) {
        for (let i = 0; i < count; i++) {
            const job = await insertJob({
                type: 'e2e-test-job',
                payload: { index: i, status },
                status,
                attempts:
                    status === 'processing' ||
                    status === 'completed' ||
                    status === 'failed'
                        ? 1
                        : 0,
                started_at:
                    status === 'processing' ||
                    status === 'completed' ||
                    status === 'failed'
                        ? new Date(now.getTime() - 60_000)
                        : null,
                completed_at:
                    status === 'completed' || status === 'failed'
                        ? new Date(now.getTime() - 30_000)
                        : null,
                error:
                    status === 'failed' ? 'E2E test simulated failure' : null,
            });
            jobs.push(job);
        }
    }

    return jobs;
}

export async function cleanupJobs(jobs: DbJob[]): Promise<void> {
    for (const job of jobs) {
        await deleteJob(job.id);
    }
}

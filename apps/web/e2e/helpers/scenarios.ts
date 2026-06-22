/**
 * E2E-specific multi-row seeders, built on the typed `@nexus/db/test-db`
 * helpers. These encode test-suite conventions (job type, distinct file names)
 * that aren't db-package concerns, and are called from `beforeAll` where counts
 * vary per describe — for per-test single-entity preconditions, prefer the
 * fixtures in `fixtures/data.ts` instead.
 */
import {
    type Connection,
    type Job,
    type File,
    insertJob,
    insertFile,
    deleteJob,
    deleteFile,
} from '@nexus/db/test-db';

export interface SeedJobsOptions {
    pending?: number;
    processing?: number;
    completed?: number;
    failed?: number;
}

/**
 * Seeds background jobs with the given per-status counts, mirroring the
 * attempts/timestamps a real job would carry at each status. Returns the
 * created jobs for cleanup.
 */
export async function seedJobs(
    db: Connection,
    options: SeedJobsOptions
): Promise<Job[]> {
    const jobs: Job[] = [];
    const now = Date.now();

    const entries = Object.entries(options) as [Job['status'], number][];
    for (const [status, count] of entries) {
        for (let i = 0; i < count; i++) {
            const ran =
                status === 'processing' ||
                status === 'completed' ||
                status === 'failed';
            const finished = status === 'completed' || status === 'failed';
            const job = await insertJob(db, {
                type: 'e2e-test-job',
                payload: { index: i, status },
                status,
                attempts: ran ? 1 : 0,
                startedAt: ran ? new Date(now - 60_000) : null,
                completedAt: finished ? new Date(now - 30_000) : null,
                error:
                    status === 'failed' ? 'E2E test simulated failure' : null,
            });
            jobs.push(job);
        }
    }

    return jobs;
}

export async function cleanupJobs(db: Connection, jobs: Job[]): Promise<void> {
    for (const job of jobs) {
        await deleteJob(db, job.id);
    }
}

/**
 * Seeds `count` files for a user with distinct names and unique s3 keys (the
 * file browser asserts on individual names, so they can't collide).
 */
export async function seedFiles(
    db: Connection,
    userId: string,
    count: number
): Promise<File[]> {
    const files: File[] = [];
    for (let i = 0; i < count; i++) {
        const file = await insertFile(db, {
            userId,
            name: `e2e-test-file-${i + 1}.txt`,
            size: 1024 * (i + 1),
            s3Key: `e2e/${userId}/test-file-${Date.now()}-${i}`,
        });
        files.push(file);
    }
    return files;
}

export async function cleanupFiles(
    db: Connection,
    files: File[]
): Promise<void> {
    for (const file of files) {
        await deleteFile(db, file.id);
    }
}

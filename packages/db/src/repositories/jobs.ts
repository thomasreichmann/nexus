import { eq, desc, sql } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';

export type Job = typeof schema.backgroundJobs.$inferSelect;
export type NewJob = typeof schema.backgroundJobs.$inferInsert;

export interface FindJobsOptions {
    limit: number;
    offset: number;
    status?: Job['status'];
}

export interface FindJobsResult {
    jobs: Job[];
    total: number;
}

export async function findJobById(
    db: DB,
    id: string
): Promise<Job | undefined> {
    return db.query.backgroundJobs.findFirst({
        where: eq(schema.backgroundJobs.id, id),
    });
}

export async function findJobs(
    db: DB,
    opts: FindJobsOptions = { limit: 50, offset: 0 }
): Promise<FindJobsResult> {
    const whereClause = opts.status
        ? eq(schema.backgroundJobs.status, opts.status)
        : undefined;

    const [jobs, [countResult]] = await Promise.all([
        db.query.backgroundJobs.findMany({
            where: whereClause,
            orderBy: desc(schema.backgroundJobs.createdAt),
            limit: opts.limit,
            offset: opts.offset,
        }),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.backgroundJobs)
            .where(whereClause),
    ]);

    return { jobs, total: countResult?.count ?? 0 };
}

interface JobStatusCounts {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

export async function countJobsByStatus(db: DB): Promise<JobStatusCounts> {
    const rows = await db
        .select({
            status: schema.backgroundJobs.status,
            count: sql<number>`count(*)::int`,
        })
        .from(schema.backgroundJobs)
        .groupBy(schema.backgroundJobs.status);

    const counts: JobStatusCounts = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
    };

    for (const row of rows) {
        counts[row.status] = row.count;
    }

    return counts;
}

export async function insertJob(db: DB, data: NewJob): Promise<Job> {
    const [job] = await db
        .insert(schema.backgroundJobs)
        .values(data)
        .returning();
    return job;
}

export async function updateJob(
    db: DB,
    id: string,
    data: Partial<Omit<NewJob, 'id'>>
): Promise<Job | undefined> {
    const [job] = await db
        .update(schema.backgroundJobs)
        .set(data)
        .where(eq(schema.backgroundJobs.id, id))
        .returning();

    return job;
}

export async function markJobProcessing(db: DB, id: string): Promise<void> {
    await db
        .update(schema.backgroundJobs)
        .set({
            status: 'processing',
            attempts: sql`${schema.backgroundJobs.attempts} + 1`,
            startedAt: new Date(),
        })
        .where(eq(schema.backgroundJobs.id, id));
}

export function createJobRepo(db: DB) {
    return {
        findById: (id: string) => findJobById(db, id),
        findMany: (opts?: FindJobsOptions) => findJobs(db, opts),
        countByStatus: () => countJobsByStatus(db),
        insert: (data: NewJob) => insertJob(db, data),
        update: (id: string, data: Partial<Omit<NewJob, 'id'>>) =>
            updateJob(db, id, data),
        markProcessing: (id: string) => markJobProcessing(db, id),
    };
}
export type JobRepo = ReturnType<typeof createJobRepo>;

// Re-export job types for the @nexus/db/repo/jobs subpath
export * from '../jobs/types';

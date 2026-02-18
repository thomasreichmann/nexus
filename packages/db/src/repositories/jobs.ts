import { eq, desc, sql } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type Job = typeof schema.backgroundJobs.$inferSelect;
export type NewJob = typeof schema.backgroundJobs.$inferInsert;

export interface FindManyOptions {
    limit: number;
    offset: number;
    status?: Job['status'];
}

export interface FindManyResult {
    jobs: Job[];
    total: number;
}

async function findById(db: DB, id: string): Promise<Job | undefined> {
    return db.query.backgroundJobs.findFirst({
        where: eq(schema.backgroundJobs.id, id),
    });
}

async function findMany(
    db: DB,
    opts: FindManyOptions = { limit: 50, offset: 0 }
): Promise<FindManyResult> {
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

interface StatusCounts {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

async function countByStatus(db: DB): Promise<StatusCounts> {
    const rows = await db
        .select({
            status: schema.backgroundJobs.status,
            count: sql<number>`count(*)::int`,
        })
        .from(schema.backgroundJobs)
        .groupBy(schema.backgroundJobs.status);

    const counts: StatusCounts = {
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

async function insert(db: DB, data: NewJob): Promise<Job> {
    const [job] = await db
        .insert(schema.backgroundJobs)
        .values(data)
        .returning();
    return job;
}

async function update(
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

async function markProcessing(db: DB, id: string): Promise<void> {
    await db
        .update(schema.backgroundJobs)
        .set({
            status: 'processing',
            attempts: sql`${schema.backgroundJobs.attempts} + 1`,
            startedAt: new Date(),
        })
        .where(eq(schema.backgroundJobs.id, id));
}

export const createJobRepo = createRepository({
    findById,
    findMany,
    countByStatus,
    insert,
    update,
    markProcessing,
});

export type JobRepo = ReturnType<typeof createJobRepo>;

// Re-export job types for the @nexus/db/repo/jobs subpath
export * from '../jobs/types';

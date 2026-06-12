import postgres from 'postgres';
import { config } from 'dotenv';
import { PLAN_LIMITS, type PlanTier } from '@nexus/db/plans';

config({ path: '.env.local', quiet: true });

let sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
    if (!sql) {
        sql = postgres(process.env.DATABASE_URL!);
    }
    return sql;
}

export interface DbUser {
    id: string;
    email: string;
    name: string;
    role: string;
}

export interface DbJob {
    id: string;
    type: string;
    payload: unknown;
    status: string;
    attempts: number;
    error: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export async function findUserByEmail(
    email: string
): Promise<DbUser | undefined> {
    const sql = getDb();
    const [user] = await sql<DbUser[]>`
        SELECT id, email, name, role FROM "user" WHERE email = ${email}
    `;
    return user;
}

export async function updateUserRole(
    email: string,
    role: string
): Promise<void> {
    const sql = getDb();
    await sql`UPDATE "user" SET role = ${role} WHERE email = ${email}`;
}

export interface InsertJobData {
    type: string;
    payload: unknown;
    status?: string;
    attempts?: number;
    error?: string | null;
    started_at?: Date | null;
    completed_at?: Date | null;
}

export async function insertJob(data: InsertJobData): Promise<DbJob> {
    const sql = getDb();
    const [job] = await sql<DbJob[]>`
        INSERT INTO background_jobs (id, type, payload, status, attempts, error, started_at, completed_at)
        VALUES (
            gen_random_uuid(),
            ${data.type},
            ${JSON.stringify(data.payload)},
            ${data.status ?? 'pending'},
            ${data.attempts ?? 0},
            ${data.error ?? null},
            ${data.started_at ?? null},
            ${data.completed_at ?? null}
        )
        RETURNING *
    `;
    return job;
}

export async function deleteJob(id: string): Promise<void> {
    const sql = getDb();
    await sql`DELETE FROM background_jobs WHERE id = ${id}`;
}

export interface JobCounts {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}

export interface DbFile {
    id: string;
    user_id: string;
    name: string;
    size: number;
    s3_key: string;
    storage_tier: string;
    status: string;
    created_at: Date;
    updated_at: Date;
}

export interface InsertFileData {
    userId: string;
    name: string;
    size?: number;
    s3Key: string;
    storageTier?: string;
    status?: string;
    /** Groups the file under an upload batch (see `insertBatch`) */
    batchId?: string | null;
}

export async function insertFile(data: InsertFileData): Promise<DbFile> {
    const sql = getDb();
    const [file] = await sql<DbFile[]>`
        INSERT INTO files (id, user_id, batch_id, name, size, s3_key, storage_tier, status)
        VALUES (
            gen_random_uuid(),
            ${data.userId},
            ${data.batchId ?? null},
            ${data.name},
            ${data.size ?? 1024},
            ${data.s3Key},
            ${data.storageTier ?? 'glacier'},
            ${data.status ?? 'available'}
        )
        RETURNING *
    `;
    return file;
}

export async function insertBatch(data: {
    userId: string;
    name: string;
}): Promise<{ id: string }> {
    const sql = getDb();
    const [batch] = await sql<{ id: string }[]>`
        INSERT INTO upload_batches (id, user_id, name)
        VALUES (gen_random_uuid()::text, ${data.userId}, ${data.name})
        RETURNING id
    `;
    return batch;
}

/**
 * Removes all domain data hanging off a user (retrievals, files, batches)
 * without deleting the user itself. The single cleanup/reset for specs that
 * seed file data — keeping it here means a new user-scoped table gets added
 * once, not per spec.
 */
export async function deleteUserData(userId: string): Promise<void> {
    const sql = getDb();
    await sql`DELETE FROM retrievals WHERE user_id = ${userId}`;
    await sql`DELETE FROM files WHERE user_id = ${userId}`;
    await sql`DELETE FROM upload_batches WHERE user_id = ${userId}`;
}

export async function deleteFile(id: string): Promise<void> {
    const sql = getDb();
    await sql`DELETE FROM files WHERE id = ${id}`;
}

export interface InsertRetrievalData {
    fileId: string;
    userId: string;
    status?: string;
    tier?: string;
}

/**
 * Inserts a retrieval row directly. Seeding `status: 'ready'` is the only way
 * to exercise the download path in E2E — `getDownloadUrl` requires a ready
 * retrieval, and a real Glacier restore takes hours.
 */
export async function insertRetrieval(
    data: InsertRetrievalData
): Promise<{ id: string }> {
    const sql = getDb();
    const [row] = await sql<{ id: string }[]>`
        INSERT INTO retrievals (id, file_id, user_id, status, tier, initiated_at, ready_at)
        VALUES (
            gen_random_uuid()::text,
            ${data.fileId},
            ${data.userId},
            ${data.status ?? 'ready'},
            ${data.tier ?? 'standard'},
            NOW() - INTERVAL '1 hour',
            NOW()
        )
        RETURNING id
    `;
    return row;
}

/**
 * Removes a test user entirely. All domain tables (files, upload_batches,
 * storage_usage, retrievals, subscriptions) and BetterAuth tables (session,
 * account) cascade on user delete.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
    const sql = getDb();
    await sql`DELETE FROM "user" WHERE email = ${email}`;
}

/**
 * Upserts the user's subscription row to a fresh trial state. Used by global
 * setup (the seeded e2e user is reused across test runs and may pre-date the
 * `provisionTrialSubscription` signup hook) and as the `afterEach` reset for
 * tests that mutate state via `markSubscriptionPaid`. Forcing the columns
 * back means a previous test that crashed before `afterEach` can't leak paid
 * state into the next run.
 */
export async function ensureTrialSubscription(userId: string): Promise<void> {
    const sql = getDb();
    await sql`
        INSERT INTO subscriptions (
            id, user_id, stripe_customer_id, plan_tier, status,
            storage_limit, trial_end
        ) VALUES (
            gen_random_uuid()::text,
            ${userId},
            ${`cus_test_${userId}`},
            'starter',
            'trialing',
            ${PLAN_LIMITS.starter},
            NOW() + INTERVAL '30 days'
        )
        ON CONFLICT (user_id) DO UPDATE SET
            status = EXCLUDED.status,
            plan_tier = EXCLUDED.plan_tier,
            storage_limit = EXCLUDED.storage_limit,
            trial_end = EXCLUDED.trial_end,
            stripe_subscription_id = NULL,
            current_period_start = NULL,
            current_period_end = NULL,
            cancel_at_period_end = FALSE
    `;
}

/**
 * Promotes a seeded trial subscription to an active paid one. Tests that
 * exercise the paid-user code paths (e.g. Upgrade-routes-to-portal) flip the
 * row before the test and call `ensureTrialSubscription` after.
 */
export async function markSubscriptionPaid(
    userId: string,
    options?: { tier?: PlanTier }
): Promise<void> {
    const sql = getDb();
    const tier = options?.tier ?? 'pro';
    await sql`
        UPDATE subscriptions
        SET status = 'active',
            plan_tier = ${tier},
            stripe_subscription_id = ${`sub_test_${userId}`},
            current_period_start = NOW(),
            current_period_end = NOW() + INTERVAL '30 days',
            trial_end = NULL,
            cancel_at_period_end = FALSE,
            storage_limit = ${PLAN_LIMITS[tier]}
        WHERE user_id = ${userId}
    `;
}

export async function countJobsByStatus(): Promise<JobCounts> {
    const sql = getDb();
    const rows = await sql<{ status: string; count: number }[]>`
        SELECT status, count(*)::int as count
        FROM background_jobs
        GROUP BY status
    `;

    const counts: JobCounts = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
    };
    for (const row of rows) {
        if (row.status in counts) {
            counts[row.status as keyof JobCounts] = row.count;
        }
    }
    return counts;
}

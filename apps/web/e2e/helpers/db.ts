import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

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

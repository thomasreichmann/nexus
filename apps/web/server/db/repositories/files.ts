import { eq, and, desc, sql } from 'drizzle-orm';
import type { DB } from '../index';
import * as schema from '../schema';

/** File record from the database */
export type File = typeof schema.files.$inferSelect;

/** Data for inserting a new file */
export type NewFile = typeof schema.files.$inferInsert;

// ─────────────────────────────────────────────────────────────
// Queries - use Drizzle's relational query API (db.query.*)
// ─────────────────────────────────────────────────────────────

/** Find a single file by ID. Returns undefined if not found. */
export function findFileById(db: DB, id: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.id, id),
    });
}

/** Find a file owned by a specific user. */
export function findUserFile(
    db: DB,
    userId: string,
    fileId: string
): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: and(
            eq(schema.files.id, fileId),
            eq(schema.files.userId, userId)
        ),
    });
}

/** List files for a user with pagination. */
export function findFilesByUser(
    db: DB,
    userId: string,
    opts: { limit: number; offset: number } = { limit: 50, offset: 0 }
): Promise<File[]> {
    return db.query.files.findMany({
        where: eq(schema.files.userId, userId),
        orderBy: desc(schema.files.createdAt),
        limit: opts.limit,
        offset: opts.offset,
    });
}

// ─────────────────────────────────────────────────────────────
// Aggregates - use query builders when relational API isn't enough
// ─────────────────────────────────────────────────────────────

/** Calculate total storage used by a user in bytes. */
export async function sumStorageBytesByUser(
    db: DB,
    userId: string
): Promise<number> {
    const [result] = await db
        .select({
            total: sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`,
        })
        .from(schema.files)
        .where(eq(schema.files.userId, userId));

    return Number(result?.total ?? 0);
}

// ─────────────────────────────────────────────────────────────
// Mutations - always use .returning() with destructuring
// ─────────────────────────────────────────────────────────────

/** Insert a new file record. */
export async function insertFile(db: DB, data: NewFile): Promise<File> {
    const [file] = await db.insert(schema.files).values(data).returning();
    return file;
}

/** Update a file by ID. Returns undefined if file doesn't exist. */
export async function updateFile(
    db: DB,
    id: string,
    data: Partial<Omit<NewFile, 'id'>>
): Promise<File | undefined> {
    const [file] = await db
        .update(schema.files)
        .set(data)
        .where(eq(schema.files.id, id))
        .returning();

    return file;
}

/** Delete a file by ID. Returns the deleted row, or undefined if not found. */
export async function deleteFile(
    db: DB,
    id: string
): Promise<File | undefined> {
    const [file] = await db
        .delete(schema.files)
        .where(eq(schema.files.id, id))
        .returning();

    return file;
}

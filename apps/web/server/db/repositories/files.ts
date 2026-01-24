import { eq, and, desc, sql } from 'drizzle-orm';
import type { DB } from '../index';
import * as schema from '../schema';

export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;

export function findFileById(db: DB, id: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.id, id),
    });
}

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

export async function insertFile(db: DB, data: NewFile): Promise<File> {
    const [file] = await db.insert(schema.files).values(data).returning();
    return file;
}

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

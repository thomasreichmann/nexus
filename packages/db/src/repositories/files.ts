import { eq, and, desc, sql, notInArray, inArray, ne } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';

export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;

export interface FindFilesByUserOptions {
    limit: number;
    offset: number;
    includeHidden?: boolean;
}

export function findFileById(db: DB, id: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.id, id),
    });
}

export function findByS3Key(db: DB, s3Key: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.s3Key, s3Key),
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

export function findUserFiles(
    db: DB,
    userId: string,
    fileIds: string[]
): Promise<File[]> {
    if (fileIds.length === 0) return Promise.resolve([]);
    return db.query.files.findMany({
        where: and(
            inArray(schema.files.id, fileIds),
            eq(schema.files.userId, userId)
        ),
    });
}

const hiddenStatuses: (typeof schema.files.status.enumValues)[number][] = [
    'uploading',
    'deleted',
];

function buildUserFilesWhereClause(userId: string, includeHidden: boolean) {
    return includeHidden
        ? eq(schema.files.userId, userId)
        : and(
              eq(schema.files.userId, userId),
              notInArray(schema.files.status, hiddenStatuses)
          );
}

export function findFilesByUser(
    db: DB,
    userId: string,
    opts: FindFilesByUserOptions = { limit: 50, offset: 0 }
): Promise<File[]> {
    return db.query.files.findMany({
        where: buildUserFilesWhereClause(userId, opts.includeHidden ?? false),
        orderBy: desc(schema.files.createdAt),
        limit: opts.limit,
        offset: opts.offset,
    });
}

export async function countFilesByUser(
    db: DB,
    userId: string,
    opts: { includeHidden?: boolean } = {}
): Promise<number> {
    const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.files)
        .where(buildUserFilesWhereClause(userId, opts.includeHidden ?? false));

    return result?.count ?? 0;
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

export async function softDeleteFile(
    db: DB,
    fileId: string
): Promise<File | undefined> {
    const [file] = await db
        .update(schema.files)
        .set({
            status: 'deleted',
            deletedAt: new Date(),
        })
        .where(eq(schema.files.id, fileId))
        .returning();

    return file;
}

export async function softDeleteFiles(
    db: DB,
    fileIds: string[]
): Promise<File[]> {
    if (fileIds.length === 0) return [];

    return db
        .update(schema.files)
        .set({
            status: 'deleted',
            deletedAt: new Date(),
        })
        .where(inArray(schema.files.id, fileIds))
        .returning();
}

export async function softDeleteUserFiles(
    db: DB,
    userId: string,
    fileIds: string[]
): Promise<File[]> {
    if (fileIds.length === 0) return [];

    return db
        .update(schema.files)
        .set({
            status: 'deleted',
            deletedAt: new Date(),
        })
        .where(
            and(
                inArray(schema.files.id, fileIds),
                eq(schema.files.userId, userId),
                ne(schema.files.status, 'deleted')
            )
        )
        .returning();
}

export function createFileRepo(db: DB) {
    return {
        findById: (id: string) => findFileById(db, id),
        findByS3Key: (s3Key: string) => findByS3Key(db, s3Key),
        findByUserAndId: (userId: string, fileId: string) =>
            findUserFile(db, userId, fileId),
        findManyByUserAndIds: (userId: string, fileIds: string[]) =>
            findUserFiles(db, userId, fileIds),
        findByUser: (userId: string, opts?: FindFilesByUserOptions) =>
            findFilesByUser(db, userId, opts),
        countByUser: (userId: string, opts?: { includeHidden?: boolean }) =>
            countFilesByUser(db, userId, opts),
        sumStorageByUser: (userId: string) => sumStorageBytesByUser(db, userId),
        insert: (data: NewFile) => insertFile(db, data),
        update: (id: string, data: Partial<Omit<NewFile, 'id'>>) =>
            updateFile(db, id, data),
        delete: (id: string) => deleteFile(db, id),
        softDelete: (fileId: string) => softDeleteFile(db, fileId),
        softDeleteMany: (fileIds: string[]) => softDeleteFiles(db, fileIds),
        softDeleteForUser: (userId: string, fileIds: string[]) =>
            softDeleteUserFiles(db, userId, fileIds),
    };
}
export type FileRepo = ReturnType<typeof createFileRepo>;

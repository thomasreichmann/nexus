import { eq, and, desc, sql, notInArray, inArray, ne } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';

export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;

export interface FindByUserOptions {
    limit: number;
    offset: number;
    includeHidden?: boolean;
}

function findById(db: DB, id: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.id, id),
    });
}

function findByS3Key(db: DB, s3Key: string): Promise<File | undefined> {
    return db.query.files.findFirst({
        where: eq(schema.files.s3Key, s3Key),
    });
}

function findByUserAndId(
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

function findManyByUserAndIds(
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

function findByUser(
    db: DB,
    userId: string,
    opts: FindByUserOptions = { limit: 50, offset: 0 }
): Promise<File[]> {
    return db.query.files.findMany({
        where: buildUserFilesWhereClause(userId, opts.includeHidden ?? false),
        orderBy: desc(schema.files.createdAt),
        limit: opts.limit,
        offset: opts.offset,
    });
}

async function countByUser(
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

async function sumStorageByUser(db: DB, userId: string): Promise<number> {
    const [result] = await db
        .select({
            total: sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`,
        })
        .from(schema.files)
        .where(eq(schema.files.userId, userId));

    return Number(result?.total ?? 0);
}

async function insert(db: DB, data: NewFile): Promise<File> {
    const [file] = await db.insert(schema.files).values(data).returning();
    return file;
}

async function update(
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

async function remove(db: DB, id: string): Promise<File | undefined> {
    const [file] = await db
        .delete(schema.files)
        .where(eq(schema.files.id, id))
        .returning();

    return file;
}

async function softDelete(db: DB, fileId: string): Promise<File | undefined> {
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

async function softDeleteMany(db: DB, fileIds: string[]): Promise<File[]> {
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

async function softDeleteForUser(
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
        findById: (id: string) => findById(db, id),
        findByS3Key: (s3Key: string) => findByS3Key(db, s3Key),
        findByUserAndId: (userId: string, fileId: string) =>
            findByUserAndId(db, userId, fileId),
        findManyByUserAndIds: (userId: string, fileIds: string[]) =>
            findManyByUserAndIds(db, userId, fileIds),
        findByUser: (userId: string, opts?: FindByUserOptions) =>
            findByUser(db, userId, opts),
        countByUser: (userId: string, opts?: { includeHidden?: boolean }) =>
            countByUser(db, userId, opts),
        sumStorageByUser: (userId: string) => sumStorageByUser(db, userId),
        insert: (data: NewFile) => insert(db, data),
        update: (id: string, data: Partial<Omit<NewFile, 'id'>>) =>
            update(db, id, data),
        delete: (id: string) => remove(db, id),
        softDelete: (fileId: string) => softDelete(db, fileId),
        softDeleteMany: (fileIds: string[]) => softDeleteMany(db, fileIds),
        softDeleteForUser: (userId: string, fileIds: string[]) =>
            softDeleteForUser(db, userId, fileIds),
    };
}

export type FileRepo = ReturnType<typeof createFileRepo>;

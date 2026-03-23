import { eq, and, desc, sql, notInArray, inArray, ne, gte } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

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
        .where(buildUserFilesWhereClause(userId, false));

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

export interface StorageByCategory {
    category: string;
    totalBytes: number;
    fileCount: number;
}

async function sumStorageByMimeCategory(
    db: DB,
    userId: string
): Promise<StorageByCategory[]> {
    const rows = await db
        .select({
            category: sql<string>`
                CASE
                    WHEN ${schema.files.mimeType} LIKE 'image/%' THEN 'Images'
                    WHEN ${schema.files.mimeType} LIKE 'video/%' THEN 'Videos'
                    WHEN ${schema.files.mimeType} LIKE 'application/pdf'
                        OR ${schema.files.mimeType} LIKE 'application/%document%'
                        OR ${schema.files.mimeType} LIKE 'application/%sheet%'
                        OR ${schema.files.mimeType} LIKE 'text/%' THEN 'Documents'
                    WHEN ${schema.files.mimeType} LIKE 'application/zip'
                        OR ${schema.files.mimeType} LIKE 'application/gzip'
                        OR ${schema.files.mimeType} LIKE 'application/x-tar'
                        OR ${schema.files.mimeType} LIKE 'application/x-rar%'
                        OR ${schema.files.mimeType} LIKE 'application/x-7z%' THEN 'Archives'
                    ELSE 'Other'
                END`.as('category'),
            totalBytes:
                sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`.as(
                    'total_bytes'
                ),
            fileCount: sql<number>`count(*)::int`.as('file_count'),
        })
        .from(schema.files)
        .where(
            and(
                eq(schema.files.userId, userId),
                notInArray(schema.files.status, hiddenStatuses)
            )
        )
        .groupBy(sql`category`)
        .orderBy(sql`total_bytes DESC`);

    return rows.map((r) => ({
        category: r.category,
        totalBytes: Number(r.totalBytes),
        fileCount: r.fileCount,
    }));
}

export interface DailyUploadVolume {
    date: string;
    totalBytes: number;
}

async function uploadHistoryByDay(
    db: DB,
    userId: string,
    days: number = 30
): Promise<DailyUploadVolume[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await db
        .select({
            date: sql<string>`to_char(${schema.files.createdAt}, 'YYYY-MM-DD')`.as(
                'date'
            ),
            totalBytes:
                sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`.as(
                    'total_bytes'
                ),
        })
        .from(schema.files)
        .where(
            and(
                eq(schema.files.userId, userId),
                notInArray(schema.files.status, hiddenStatuses),
                gte(schema.files.createdAt, since)
            )
        )
        .groupBy(sql`date`)
        .orderBy(sql`date ASC`);

    return rows.map((r) => ({
        date: r.date,
        totalBytes: Number(r.totalBytes),
    }));
}

export const createFileRepo = createRepository({
    findById,
    findByS3Key,
    findByUserAndId,
    findManyByUserAndIds,
    findByUser,
    countByUser,
    sumStorageByUser,
    insert,
    update,
    delete: remove,
    softDelete,
    softDeleteMany,
    softDeleteForUser,
    sumStorageByMimeCategory,
    uploadHistoryByDay,
});

export type FileRepo = ReturnType<typeof createFileRepo>;

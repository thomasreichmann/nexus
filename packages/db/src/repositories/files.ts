import {
    eq,
    and,
    asc,
    desc,
    sql,
    notInArray,
    inArray,
    ne,
    gte,
    ilike,
} from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;

export type FileSortKey = 'name' | 'size' | 'uploadedAt';
export type FileSortOrder = 'asc' | 'desc';

export interface FindByUserOptions {
    limit: number;
    offset: number;
    includeHidden?: boolean;
    search?: string;
    sortKey?: FileSortKey;
    sortOrder?: FileSortOrder;
}

export interface CountByUserOptions {
    includeHidden?: boolean;
    search?: string;
}

export interface StatusCategoryCounts {
    archived: number;
    retrieving: number;
    available: number;
}

const SORT_COLUMNS = {
    name: schema.files.name,
    size: schema.files.size,
    uploadedAt: schema.files.createdAt,
} as const;

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

function buildUserFilesWhereClause(
    userId: string,
    includeHidden: boolean,
    search?: string
) {
    const trimmed = search?.trim();
    const conditions = [eq(schema.files.userId, userId)];
    if (!includeHidden) {
        conditions.push(notInArray(schema.files.status, hiddenStatuses));
    }
    if (trimmed) {
        conditions.push(ilike(schema.files.name, `%${trimmed}%`));
    }
    return and(...conditions);
}

function findByUser(
    db: DB,
    userId: string,
    opts: FindByUserOptions
): Promise<File[]> {
    const direction = opts.sortOrder === 'asc' ? asc : desc;
    const sortColumn = SORT_COLUMNS[opts.sortKey ?? 'uploadedAt'];
    return db.query.files.findMany({
        where: buildUserFilesWhereClause(
            userId,
            opts.includeHidden ?? false,
            opts.search
        ),
        // Tiebreak on id to guarantee stable paging when sort values tie.
        orderBy: [direction(sortColumn), direction(schema.files.id)],
        limit: opts.limit,
        offset: opts.offset,
    });
}

async function countByUser(
    db: DB,
    userId: string,
    opts: CountByUserOptions = {}
): Promise<number> {
    const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.files)
        .where(
            buildUserFilesWhereClause(
                userId,
                opts.includeHidden ?? false,
                opts.search
            )
        );

    return result?.count ?? 0;
}

/**
 * Library-wide status bucket counts for a user. Mirrors deriveStatus in
 * apps/web/components/dashboard/file-browser.tsx — keep the two in lockstep
 * or UI counts will disagree with per-row status dots.
 */
async function countStatusesByUser(
    db: DB,
    userId: string,
    opts: { includeHidden?: boolean } = {}
): Promise<StatusCategoryCounts> {
    const rows = await db
        .select({
            category: sql<keyof StatusCategoryCounts>`
                CASE
                    WHEN ${schema.files.status} = 'restoring' THEN 'retrieving'
                    WHEN ${schema.files.status} = 'available'
                        AND ${schema.files.storageTier} IN ('glacier', 'deep_archive') THEN 'archived'
                    WHEN ${schema.files.status} = 'available'
                        AND ${schema.files.storageTier} = 'standard' THEN 'available'
                END`.as('category'),
            count: sql<number>`count(*)::int`.as('count'),
        })
        .from(schema.files)
        .where(buildUserFilesWhereClause(userId, opts.includeHidden ?? false))
        .groupBy(sql`category`);

    const counts: StatusCategoryCounts = {
        archived: 0,
        retrieving: 0,
        available: 0,
    };
    for (const row of rows) {
        counts[row.category] = row.count;
    }
    return counts;
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
    countStatusesByUser,
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

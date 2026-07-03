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
import { activeRetrievalFilter } from './retrievals';

export type File = typeof schema.files.$inferSelect;
export type NewFile = typeof schema.files.$inferInsert;

export interface ActiveRetrievalSummary {
    status: (typeof schema.retrievals.status.enumValues)[number];
    expiresAt: Date | null;
}

/**
 * File row plus its active retrieval, if any. At most one retrieval per file
 * matches the active predicate: the retrieval service skips files that
 * already have an active row, so the join can't fan out.
 */
export type FileWithRetrieval = File & {
    activeRetrieval: ActiveRetrievalSummary | null;
};

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

function findByUserAndBatch(
    db: DB,
    userId: string,
    batchId: string
): Promise<File[]> {
    return db.query.files.findMany({
        where: and(
            eq(schema.files.batchId, batchId),
            eq(schema.files.userId, userId)
        ),
    });
}

const hiddenStatuses: (typeof schema.files.status.enumValues)[number][] = [
    'uploading',
    'deleted',
];

// Escape LIKE/ILIKE wildcards so a search for "100%" or "foo_bar" is treated
// as a literal substring, not a pattern. Postgres' default escape char is `\`.
function escapeLikePattern(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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
        conditions.push(
            ilike(schema.files.name, `%${escapeLikePattern(trimmed)}%`)
        );
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
 * or UI counts will disagree with per-row status dots. Hidden statuses
 * (`uploading`, `deleted`) are always excluded since they don't fit any
 * bucket and would produce a NULL category from the CASE below. Buckets are
 * derived from the file's active retrieval first (ready → available,
 * queued/restoring → retrieving), so both tiers count identically (#259).
 */
async function countStatusesByUser(
    db: DB,
    userId: string
): Promise<StatusCategoryCounts> {
    const rows = await db
        .select({
            category: sql<keyof StatusCategoryCounts | null>`
                CASE
                    WHEN ${schema.retrievals.status} = 'ready' THEN 'available'
                    WHEN ${schema.retrievals.status} IN ('pending', 'in_progress') THEN 'retrieving'
                    WHEN ${schema.files.status} = 'restoring' THEN 'retrieving'
                    WHEN ${schema.files.status} = 'available' THEN 'archived'
                    ELSE NULL
                END`.as('category'),
            // DISTINCT guards against join fan-out from duplicate active
            // retrievals (#266) double-counting a file within a bucket.
            count: sql<number>`count(distinct ${schema.files.id})::int`.as(
                'count'
            ),
        })
        .from(schema.files)
        .leftJoin(
            schema.retrievals,
            and(
                eq(schema.retrievals.fileId, schema.files.id),
                activeRetrievalFilter()
            )
        )
        .where(buildUserFilesWhereClause(userId, false))
        .groupBy(sql`category`);

    const counts: StatusCategoryCounts = {
        archived: 0,
        retrieving: 0,
        available: 0,
    };
    for (const row of rows) {
        if (row.category) counts[row.category] = row.count;
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

export interface FileBatchGroup {
    // `null` when the group holds legacy files with no batch — the UI
    // synthesizes the "Ungrouped" label so presentation stays in the UI.
    batchId: string | null;
    batchName: string | null;
    batchCreatedAt: Date | null;
    files: FileWithRetrieval[];
}

// Postgres defaults DESC to NULLS FIRST; we want orphan (null-batch) rows
// to land at the end of the result, hence the explicit `NULLS LAST`.
async function findByUserGroupedByBatch(
    db: DB,
    userId: string,
    opts: { includeHidden?: boolean } = {}
): Promise<FileBatchGroup[]> {
    const rows = await db
        .select({
            file: schema.files,
            batchName: schema.uploadBatches.name,
            batchCreatedAt: schema.uploadBatches.createdAt,
            retrievalStatus: schema.retrievals.status,
            retrievalExpiresAt: schema.retrievals.expiresAt,
        })
        .from(schema.files)
        .leftJoin(
            schema.uploadBatches,
            eq(schema.files.batchId, schema.uploadBatches.id)
        )
        .leftJoin(
            schema.retrievals,
            and(
                eq(schema.retrievals.fileId, schema.files.id),
                activeRetrievalFilter()
            )
        )
        .where(buildUserFilesWhereClause(userId, opts.includeHidden ?? false))
        .orderBy(
            sql`${schema.uploadBatches.createdAt} DESC NULLS LAST`,
            desc(schema.files.createdAt),
            desc(schema.files.id)
        );

    const NULL_KEY = '\0';
    const groups = new Map<string, FileBatchGroup>();
    for (const row of rows) {
        const key = row.file.batchId ?? NULL_KEY;
        let group = groups.get(key);
        if (!group) {
            group = {
                batchId: row.file.batchId,
                batchName: row.batchName,
                batchCreatedAt: row.batchCreatedAt,
                files: [],
            };
            groups.set(key, group);
        }
        // The service guards against concurrent duplicate active retrievals,
        // but nothing at the DB level does yet (#266) — if a race slips two
        // active rows in, the join fans out. Keep the first row (duplicates
        // are adjacent: ordering is by file columns only) rather than
        // duplicating the file in the UI.
        if (group.files.at(-1)?.id === row.file.id) continue;
        group.files.push({
            ...row.file,
            activeRetrieval: row.retrievalStatus
                ? {
                      status: row.retrievalStatus,
                      expiresAt: row.retrievalExpiresAt,
                  }
                : null,
        });
    }

    return Array.from(groups.values());
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
    findByUserAndBatch,
    findByUser,
    findByUserGroupedByBatch,
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

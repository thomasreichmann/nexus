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
    lt,
    ilike,
} from 'drizzle-orm';
import * as schema from '../schema';
import { createRepository } from './create';
import { activeRetrievalFilter } from './retrievals';
import type { DB } from '../connection';

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

/**
 * Derived-bucket key for a file's thumbnail. A pure function of immutable
 * row fields — no key column, no S3 listing; the DB row stays source of
 * truth and regeneration is an idempotent overwrite. Deliberately excludes
 * batchId (unlike the original's s3Key): it's nullable and batch deletion
 * sets it null, which would silently re-point the computed key.
 */
export function thumbnailKey(file: Pick<File, 'userId' | 'id'>): string {
    return `${file.userId}/${file.id}/thumb.webp`;
}

/**
 * Key of the uploaded object itself, in the originals bucket. The upload
 * services built this string inline in two places (#364); it lives here so
 * the shape has one definition.
 *
 * Not a `Pick<File, …>` on purpose, unlike `thumbnailKey`: `File['batchId']`
 * is nullable and batch deletion sets it null, so a row that has already lost
 * its batch would compute a key its object was never stored under. Callers
 * pass the batch id they just resolved, which is always present.
 *
 * Only real uploads use this shape. Seeds, fixtures and e2e scenarios build
 * their own prefixed keys (`seed/…`, `e2e/…`) because those rows have no
 * batch and no S3 object behind them — a four-segment key there would be a
 * lie, and the prefix keeps them identifiable in a real bucket listing.
 */
export function originalKey(file: {
    userId: string;
    batchId: string;
    id: string;
    name: string;
}): string {
    return `${file.userId}/${file.batchId}/${file.id}/${file.name}`;
}

/**
 * Key of one zip artifact of a retrieval request, in the artifacts bucket
 * (#424). Lives beside the other key builders so the delivery path (#426) hands
 * out the same names the worker wrote rather than restating the convention.
 *
 * The artifact id is a path segment rather than part of the filename: a rebuild
 * writes a fresh object under a fresh id, so an in-flight download still
 * resolves to the archive it started on. That is also why
 * `retrieval_artifacts.s3_key` is stored — this function says where a *new*
 * object goes, never where an existing one is.
 *
 * The part number is 1-based: it is the only piece of this key a user sees.
 */
export function retrievalArtifactKey(artifact: {
    userId: string;
    requestId: string;
    id: string;
    position: number;
}): string {
    return `${artifact.userId}/${artifact.requestId}/${artifact.id}/nexus-part-${artifact.position + 1}.zip`;
}

// Re-exported so a caller that already has this module doesn't need a second
// import. Defined in `../media` so client components can classify a file
// without pulling drizzle into the bundle (#364).
export { classifyMedia, type MediaKind } from '../media';

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

/** The identity the vault check matches on — no mtime, no checksum (#401). */
export interface NameAndSize {
    name: string;
    size: number;
}

function nameAndSizeKey(identity: NameAndSize): string {
    return `${identity.size}:${identity.name}`;
}

/**
 * Committed rows sharing a name and size with a candidate — the upload
 * queue's "already in your vault" check (#401). Visibility is the file
 * browser's (`buildUserFilesWhereClause`, hiding `HIDDEN_STATUSES`), so an
 * `uploading` row the user is re-dropping to recover from an interrupted
 * wave (#398) is not a duplicate: nothing was committed or billed for it.
 * The name filter does the narrowing (a library is a few thousand rows and
 * `name` has no index either way) and size is matched in memory, which keeps
 * a whole gesture to one query without a hand-built tuple IN.
 */
async function findExistingByNameAndSize(
    db: DB,
    userId: string,
    candidates: NameAndSize[]
): Promise<NameAndSize[]> {
    if (candidates.length === 0) return [];
    const wanted = new Set(candidates.map(nameAndSizeKey));
    const rows = await db.query.files.findMany({
        columns: { name: true, size: true },
        where: and(
            buildUserFilesWhereClause(userId, false),
            inArray(schema.files.name, [
                ...new Set(candidates.map((c) => c.name)),
            ])
        ),
    });
    // Once per identity: a vault that already holds two copies (what this
    // check prevents going forward) must not answer twice for one pair.
    const found = new Map<string, NameAndSize>();
    for (const row of rows) {
        const key = nameAndSizeKey(row);
        if (!wanted.has(key) || found.has(key)) continue;
        found.set(key, { name: row.name, size: row.size });
    }
    return [...found.values()];
}

/**
 * Statuses excluded from every user-facing list and every usage total:
 * `uploading` isn't confirmed yet, `deleted` has already been subtracted.
 * Exported so the seed's storage-usage snapshot filters on the same set
 * instead of retyping it (#364).
 */
export const HIDDEN_STATUSES: (typeof schema.files.status.enumValues)[number][] =
    ['uploading', 'deleted'];

/**
 * How long a row may sit in `uploading` before it counts as abandoned. Far
 * past both presigned expiries (15 min single-part, 1 h per multipart part),
 * but loose enough that a multipart upload resumed across sessions isn't
 * called stale mid-flight.
 *
 * Shared by the nightly check that flags these and the script that reaps them
 * (#330) — one threshold, so the two can't drift apart.
 */
export const STALE_UPLOAD_HOURS = 24;

/**
 * Uploads nothing is going to finish: still `uploading` well past any
 * presigned URL's life. `HIDDEN_STATUSES` keeps them out of every list and
 * every usage total, so they strand invisibly with their S3 bytes billed —
 * which is exactly why they need sweeping (#330).
 *
 * Filters on `createdAt`, not `updatedAt`: nothing touches an abandoned row
 * after the insert, so the two are equal anyway.
 */
function findStaleUploads(db: DB, olderThan: Date): Promise<File[]> {
    return db.query.files.findMany({
        where: and(
            eq(schema.files.status, 'uploading'),
            lt(schema.files.createdAt, olderThan)
        ),
    });
}

export type ThumbnailStatus =
    (typeof schema.files.thumbnailStatus.enumValues)[number];

export type ThumbnailStatusCounts = Record<ThumbnailStatus, number>;

export interface ThumbnailStatusCountOptions {
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
}

/**
 * Thumbnail-status counts across every user's visible, really-uploaded files,
 * for the nightly health check (#409). Every status is present in the result,
 * zero when no row has it.
 *
 * - Hidden rows are excluded: an `uploading` row hasn't been enqueued yet, and
 *   a `deleted` one will never be shown.
 * - Only rows keyed the way `originalKey` keys them
 *   (`<userId>/<batchId>/<fileId>/<name>`) count; the upload services are
 *   its only callers. Seed, fixture and e2e rows are inserted directly, keyed
 *   `seed/…`, `e2e/…` or `<userId>/<fileId>`, and never get a thumbnail job,
 *   so they sit at `pending` for good. Counting them made the dev health
 *   check call a working pipeline broken.
 */
async function countThumbnailStatuses(
    db: DB,
    opts: ThumbnailStatusCountOptions = {}
): Promise<ThumbnailStatusCounts> {
    const conditions = [
        notInArray(schema.files.status, HIDDEN_STATUSES),
        sql`split_part(${schema.files.s3Key}, '/', 1) = ${schema.files.userId}`,
        sql`split_part(${schema.files.s3Key}, '/', 3) = ${schema.files.id}`,
    ];
    if (opts.createdAfter) {
        conditions.push(gte(schema.files.createdAt, opts.createdAfter));
    }
    if (opts.createdBefore) {
        conditions.push(lt(schema.files.createdAt, opts.createdBefore));
    }
    if (opts.updatedAfter) {
        conditions.push(gte(schema.files.updatedAt, opts.updatedAfter));
    }

    const rows = await db
        .select({
            status: schema.files.thumbnailStatus,
            count: sql<number>`count(*)::int`,
        })
        .from(schema.files)
        .where(and(...conditions))
        .groupBy(schema.files.thumbnailStatus);

    const counts: ThumbnailStatusCounts = {
        pending: 0,
        ready: 0,
        failed: 0,
        failed_cold: 0,
        skipped: 0,
    };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
}

/**
 * The visible file whose thumbnail the worker most recently reported as
 * written. The boot check reads its object back to prove the app can reach
 * the derived bucket (#409). A real key is required because the app's IAM
 * grant is GetObject-only, so a made-up key answers 403 whether the bucket is
 * healthy or not. Newest, not arbitrary, so one old row whose object has gone
 * missing can't pass for a broken bucket on every cold start.
 */
function findLatestReadyThumbnail(
    db: DB
): Promise<Pick<File, 'id' | 'userId'> | undefined> {
    return db.query.files.findFirst({
        where: and(
            eq(schema.files.thumbnailStatus, 'ready'),
            notInArray(schema.files.status, HIDDEN_STATUSES)
        ),
        orderBy: desc(schema.files.updatedAt),
        columns: { id: true, userId: true },
    });
}

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
        conditions.push(notInArray(schema.files.status, HIDDEN_STATUSES));
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
 * apps/web/components/dashboard/file-browser/status.ts — keep the two in lockstep
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

/**
 * Move an upload out of `uploading` — confirmed to `available`, or released
 * to `deleted` — but only if it is still `uploading`. The status check is part
 * of the UPDATE, so of two racing transitions exactly one gets the row back
 * and the other gets `undefined` (#381). A read-then-write here let a cancel
 * and a confirm both pass the check and the later write overwrite the earlier.
 *
 * Callers do their side effects (usage increment, S3 delete) only on a
 * returned row: winning the claim is what entitles them to.
 */
async function claimUpload(
    db: DB,
    userId: string,
    fileId: string,
    to: 'available' | 'deleted'
): Promise<File | undefined> {
    const [file] = await db
        .update(schema.files)
        .set(
            to === 'deleted'
                ? { status: 'deleted', deletedAt: new Date() }
                : { status: 'available' }
        )
        .where(
            and(
                eq(schema.files.id, fileId),
                eq(schema.files.userId, userId),
                eq(schema.files.status, 'uploading')
            )
        )
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
                notInArray(schema.files.status, HIDDEN_STATUSES)
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

    // Row order within a batch is upload-start order, which the concurrent
    // upload lanes make effectively random. Sort after grouping so the batch
    // order and adjacent-duplicate skip above still rely on SQL order.
    for (const group of groups.values()) {
        group.files.sort(compareFilesByName);
    }

    return Array.from(groups.values());
}

// Fixed locale so server output doesn't depend on the host's default;
// `numeric` puts IMG_9.JPG before IMG_10.JPG, the order cameras write.
const fileNameCollator = new Intl.Collator('en', { numeric: true });

// Equal names (same file uploaded twice, or sibling camera folders
// flattened into one batch) fall back to oldest-first, then id — explicit,
// rather than inheriting the query's newest-first order.
function compareFilesByName(a: File, b: File): number {
    return (
        fileNameCollator.compare(a.name, b.name) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
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
                notInArray(schema.files.status, HIDDEN_STATUSES),
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
    findExistingByNameAndSize,
    findByUser,
    findByUserGroupedByBatch,
    countByUser,
    countStatusesByUser,
    findStaleUploads,
    countThumbnailStatuses,
    findLatestReadyThumbnail,
    sumStorageByUser,
    insert,
    update,
    delete: remove,
    claimUpload,
    softDeleteMany,
    softDeleteForUser,
    sumStorageByMimeCategory,
    uploadHistoryByDay,
});

export type FileRepo = ReturnType<typeof createFileRepo>;

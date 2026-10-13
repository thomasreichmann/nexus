import {
    and,
    asc,
    desc,
    eq,
    exists,
    gt,
    ilike,
    inArray,
    isNull,
    lte,
    or,
    sql,
    type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
    LIFECYCLE_TRANSITION_LAG_HOURS,
    LIFECYCLE_TRANSITION_MIN_BYTES,
} from '../objectState';
import * as schema from '../schema';
import { createRepository } from './create';
import {
    FILE_IS_ARCHIVED,
    FILE_IS_READY,
    FILE_IS_RESTORING,
    buildBatchFilter,
    buildContainsPattern,
    buildVisibleFilesFilter,
    type ActiveRetrievalSummary,
    type File,
} from './files';
import { buildActiveRetrievalJoin } from './retrievals';
import type { DB } from '../connection';

/*
 * The file browser's read model (#455). The library loads as keyset-paged
 * batch summaries, newest first, aggregated in SQL; a batch's files load when
 * it's opened, a page at a time, in natural filename order. Nothing here loads
 * a whole library to sort, count or summarize it in JS, so every response is
 * bounded whatever the library's size: a page of the library aggregates only
 * its own batches' files (a search reads every file once, to find matches),
 * and a page of a batch only that batch's. Rows carry what the browser renders
 * and nothing else: no `s3Key`, no `userId` (#411).
 */

/** A file as the browser shows it. */
export interface LibraryFile extends Pick<
    File,
    | 'id'
    | 'batchId'
    | 'name'
    | 'subpath'
    | 'size'
    | 'mimeType'
    | 'status'
    | 'thumbnailStatus'
    | 'thumbnailWidth'
    | 'thumbnailHeight'
    | 'durationSeconds'
    | 'createdAt'
> {
    activeRetrieval: ActiveRetrievalSummary | null;
}

/** What a batch card's cover mosaic needs from a file. */
export type LibraryCoverFile = Pick<File, 'id' | 'name' | 'thumbnailStatus'>;

export interface LibraryBatchSummary {
    /** Null for the legacy files that predate batches ("Ungrouped"). */
    batchId: string | null;
    name: string | null;
    createdAt: Date | null;
    fileCount: number;
    totalBytes: number;
    /** Files in flight: queued, or restoring. */
    restoringCount: number;
    /** Files downloadable right now. */
    readyCount: number;
    /** Earliest expiry among the ready files: the window the batch reads as. */
    readyUntil: Date | null;
    /**
     * Archived files the lifecycle has probably swept cold: what a restore of
     * the batch is estimated from, without loading its files.
     */
    archivedProbablyColdCount: number;
    /**
     * While searching, how many of the batch's files match, when the batch is
     * in the results for them. Null when every file shows: no search, or the
     * batch's own name matched.
     */
    matchCount: number | null;
    /** Up to three files for the cover mosaic, thumbnailed ones first. */
    coverFiles: LibraryCoverFile[];
}

export interface LibraryFolder {
    /** Null for the files at the top of the drop. */
    subpath: string | null;
    fileCount: number;
    /** While searching, the folder's matching files; null when all show. */
    matchCount: number | null;
}

/** An open batch: its summary, and its structure inside (#405). */
export interface LibraryBatch extends LibraryBatchSummary {
    /**
     * Its folders, when files sit in more than one place (two subfolders, or
     * one beside top-level files); null for a flat batch. While searching the
     * batch for its files, only the folders holding a match.
     */
    folders: LibraryFolder[] | null;
}

export interface BatchSummaryPage {
    batches: LibraryBatchSummary[];
    /** Pass back as `cursor` for the next page; null on the last one. */
    nextCursor: string | null;
}

export interface ListBatchSummariesOptions {
    limit: number;
    /** The last batch id of the previous page. */
    cursor?: string | null;
    search?: string;
}

/** Whose files a page is drawn from. */
export interface BatchFilesScope {
    batchId: string | null;
    /** One folder (null: the top level), or undefined for the whole batch. */
    folder?: string | null;
    /** Only the files whose name or folder matches. */
    search?: string;
}

export interface ListBatchFilesOptions extends BatchFilesScope {
    limit: number;
    /** A file id: a forward page starts at it, a backward one ends before it. */
    cursor?: string | null;
    direction?: 'forward' | 'backward';
}

export interface BatchFilesPage {
    files: LibraryFile[];
    /** Where `files[0]` sits among the scope's files. */
    startIndex: number;
    /** Files in the scope. */
    total: number;
    /** Cursor for the page after this one; null on the last. */
    nextCursor: string | null;
    /** Cursor for the page before this one; null on the first. */
    previousCursor: string | null;
}

/** Where a deep-linked file sits, and the page it opens on. */
export interface LocatedFile {
    batchId: string | null;
    subpath: string | null;
    /**
     * The first file of the page holding it, pages counted from the start of
     * its section (its folder, in a batch with folders): a forward cursor that
     * stays put however the pages around it change.
     */
    pageStartId: string;
}

const COVER_SIZE = 3;

// The order a batch lists its files in: folder by folder, top-level files
// first, then by name, both numeric-aware so IMG_9.JPG comes before
// IMG_10.JPG, the order cameras write them (#404). The `natural` collation is
// ICU's numeric one (migration 0023). Equal names (the same file uploaded
// twice) fall back to oldest first, then id, which makes the key unique: a
// keyset cursor over it can't skip or repeat a row.
const FOLDER_ORDER = sql`coalesce(${schema.files.subpath}, '') collate "natural"`;
const NAME_ORDER = sql`${schema.files.name} collate "natural"`;
const FILE_ORDER = [
    FOLDER_ORDER,
    NAME_ORDER,
    schema.files.createdAt,
    schema.files.id,
];
const FILE_KEY = sql`(${FOLDER_ORDER}, ${NAME_ORDER}, ${schema.files.createdAt}, ${schema.files.id})`;

const cursorFile = alias(schema.files, 'cursor_file');
const cursorBatch = alias(schema.uploadBatches, 'cursor_batch');

// The sort key of one of the user's files, for a keyset comparison against
// FILE_KEY. Unfiltered by status on purpose: a cursor file deleted since the
// page that handed it out still marks the same place in the order. No row
// (someone else's id) compares as null, and the page comes back empty.
function selectFileKey(db: DB, userId: string, fileId: string): SQL {
    return sql`(${db
        .select({
            folder: sql`coalesce(${cursorFile.subpath}, '') collate "natural"`,
            name: sql`${cursorFile.name} collate "natural"`,
            createdAt: cursorFile.createdAt,
            id: cursorFile.id,
        })
        .from(cursorFile)
        .where(
            and(eq(cursorFile.id, fileId), eq(cursorFile.userId, userId))
        )})`;
}

function selectBatchKey(db: DB, userId: string, batchId: string): SQL {
    return sql`(${db
        .select({
            createdAt: cursorBatch.createdAt,
            id: cursorBatch.id,
        })
        .from(cursorBatch)
        .where(
            and(eq(cursorBatch.id, batchId), eq(cursorBatch.userId, userId))
        )})`;
}

// A file matches on its name or its folder (#455): searching "104CANON" finds
// that card's photos.
function buildFileMatch(pattern: string): SQL {
    // or() is only `undefined` when called with no arguments
    return or(
        ilike(schema.files.name, pattern),
        ilike(schema.files.subpath, pattern)
    )!;
}

function buildFolderFilter(folder: string | null | undefined): SQL | undefined {
    if (folder === undefined) return undefined;
    if (folder === null) return isNull(schema.files.subpath);
    return eq(schema.files.subpath, folder);
}

// The SQL twin of `isProbablyCold` (objectState.ts), on the same constants:
// over the lifecycle's size floor and older than its lag. Built per query, as
// it stamps the cutoff at call time.
function buildProbablyColdFilter(): SQL {
    const cutoff = new Date(
        Date.now() - LIFECYCLE_TRANSITION_LAG_HOURS * 3_600_000
    );
    // and() is only `undefined` when called with no arguments
    return and(
        gt(schema.files.size, LIFECYCLE_TRANSITION_MIN_BYTES),
        lte(schema.files.createdAt, cutoff)
    )!;
}

// Aggregates over one group's visible files, joined to their active
// retrievals (one per file at most, so a sum can't be inflated).
function selectSummaryColumns(pattern: string | null) {
    return {
        fileCount: sql<number>`count(*)::int`,
        totalBytes:
            sql<number>`coalesce(sum(${schema.files.size}), 0)::bigint`.mapWith(
                Number
            ),
        restoringCount: sql<number>`(count(*) filter (where ${FILE_IS_RESTORING}))::int`,
        readyCount: sql<number>`(count(*) filter (where ${FILE_IS_READY}))::int`,
        readyUntil:
            sql<Date | null>`min(${schema.retrievals.expiresAt}) filter (where ${FILE_IS_READY})`.mapWith(
                schema.retrievals.expiresAt
            ),
        archivedProbablyColdCount: sql<number>`(count(*) filter (where ${FILE_IS_ARCHIVED} and ${buildProbablyColdFilter()}))::int`,
        matchCount: pattern
            ? sql<number>`(count(*) filter (where ${buildFileMatch(pattern)}))::int`
            : sql<number>`0`,
    };
}

interface SummaryRow {
    batchId: string | null;
    name: string | null;
    createdAt: Date | null;
    isNameMatch: boolean;
    fileCount: number;
    totalBytes: number;
    restoringCount: number;
    readyCount: number;
    readyUntil: Date | null;
    archivedProbablyColdCount: number;
    matchCount: number;
}

function selectBatchSummaries(db: DB, userId: string, pattern: string | null) {
    return db
        .select({
            batchId: schema.uploadBatches.id,
            name: schema.uploadBatches.name,
            createdAt: schema.uploadBatches.createdAt,
            isNameMatch: pattern
                ? sql<boolean>`${schema.uploadBatches.name} ilike ${pattern}`
                : sql<boolean>`false`,
            ...selectSummaryColumns(pattern),
        })
        .from(schema.uploadBatches)
        .innerJoin(
            schema.files,
            and(
                eq(schema.files.batchId, schema.uploadBatches.id),
                buildVisibleFilesFilter(userId)
            )
        )
        .leftJoin(schema.retrievals, buildActiveRetrievalJoin())
        .groupBy(schema.uploadBatches.id)
        .$dynamic();
}

// A search result is a batch whose name matches, or one holding a matching
// file. Anything else is filtered out of the list.
function buildSearchMatch(pattern: string): SQL {
    // or() is only `undefined` when called with no arguments
    return or(
        ilike(schema.uploadBatches.name, pattern),
        sql`count(*) filter (where ${buildFileMatch(pattern)}) > 0`
    )!;
}

const NEWEST_BATCH_FIRST = [
    desc(schema.uploadBatches.createdAt),
    desc(schema.uploadBatches.id),
];

// The legacy files with no batch, as one group. An aggregate without GROUP BY
// always returns a row, so an empty group comes back as fileCount 0.
async function findUngroupedRow(
    db: DB,
    userId: string,
    pattern: string | null
): Promise<SummaryRow | undefined> {
    const [row] = await db
        .select(selectSummaryColumns(pattern))
        .from(schema.files)
        .leftJoin(schema.retrievals, buildActiveRetrievalJoin())
        .where(and(buildVisibleFilesFilter(userId), buildBatchFilter(null)));
    if (!row || row.fileCount === 0) return undefined;
    return {
        ...row,
        batchId: null,
        name: null,
        createdAt: null,
        isNameMatch: false,
    };
}

// Up to `limit` summaries past the cursor, newest first. Without a search,
// which batches make the page is decided first, by keyset over the batches
// holding a visible file, and only those are summed. A search has to read
// every file to find its matches anyway, so it filters the aggregate.
async function selectSummaryPage(
    db: DB,
    userId: string,
    pattern: string | null,
    cursorFilter: SQL | undefined,
    limit: number
): Promise<SummaryRow[]> {
    const ownedPastCursor = and(
        eq(schema.uploadBatches.userId, userId),
        cursorFilter
    );
    if (pattern) {
        return selectBatchSummaries(db, userId, pattern)
            .where(ownedPastCursor)
            .having(buildSearchMatch(pattern))
            .orderBy(...NEWEST_BATCH_FIRST)
            .limit(limit);
    }
    const page = await db
        .select({ id: schema.uploadBatches.id })
        .from(schema.uploadBatches)
        .where(
            and(
                ownedPastCursor,
                exists(
                    db
                        .select({ id: schema.files.id })
                        .from(schema.files)
                        .where(
                            and(
                                eq(
                                    schema.files.batchId,
                                    schema.uploadBatches.id
                                ),
                                buildVisibleFilesFilter(userId)
                            )
                        )
                )
            )
        )
        .orderBy(...NEWEST_BATCH_FIRST)
        .limit(limit);
    if (page.length === 0) return [];
    // The page's ids are the user's own: picked above, by owner.
    return selectBatchSummaries(db, userId, null)
        .where(
            inArray(
                schema.uploadBatches.id,
                page.map((batch) => batch.id)
            )
        )
        .orderBy(...NEWEST_BATCH_FIRST);
}

/**
 * One page of the library: the user's batches that hold a visible file,
 * newest first, each summarized from its files in SQL. The legacy null-batch
 * group comes after the last batch, on the final page.
 *
 * While searching, a batch is in the results when its name matches (it shows
 * whole) or when any of its files does, by name or folder (it shows those).
 */
async function listBatchSummaries(
    db: DB,
    userId: string,
    { limit, cursor, search }: ListBatchSummariesOptions
): Promise<BatchSummaryPage> {
    const pattern = buildContainsPattern(search);
    const rows = await selectSummaryPage(
        db,
        userId,
        pattern,
        cursor
            ? sql`(${schema.uploadBatches.createdAt}, ${schema.uploadBatches.id}) < ${selectBatchKey(db, userId, cursor)}`
            : undefined,
        limit + 1
    );

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (!hasMore) {
        const ungrouped = await findUngroupedRow(db, userId, pattern);
        if (ungrouped && (!pattern || ungrouped.matchCount > 0)) {
            page.push(ungrouped);
        }
    }

    return {
        batches: await attachCovers(db, userId, page, pattern),
        nextCursor: hasMore ? page[limit - 1]!.batchId : null,
    };
}

/** How many groups the library (or a search of it) holds, Ungrouped included. */
async function countBatches(
    db: DB,
    userId: string,
    { search }: { search?: string } = {}
): Promise<number> {
    const pattern = buildContainsPattern(search);
    const matching = db
        .select({ id: schema.uploadBatches.id })
        .from(schema.uploadBatches)
        .innerJoin(
            schema.files,
            and(
                eq(schema.files.batchId, schema.uploadBatches.id),
                buildVisibleFilesFilter(userId)
            )
        )
        .where(eq(schema.uploadBatches.userId, userId))
        .groupBy(schema.uploadBatches.id)
        .having(pattern ? buildSearchMatch(pattern) : undefined)
        .as('matching');
    const [[grouped], ungrouped] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(matching),
        db
            .select({ id: schema.files.id })
            .from(schema.files)
            .where(
                and(
                    buildVisibleFilesFilter(userId),
                    buildBatchFilter(null),
                    pattern ? buildFileMatch(pattern) : undefined
                )
            )
            .limit(1),
    ]);
    return (grouped?.count ?? 0) + ungrouped.length;
}

/**
 * One batch, opened (null: the legacy Ungrouped group), with its folders.
 * Undefined when it isn't the user's or has no visible file left.
 *
 * A search that matches neither the batch's name nor any of its files doesn't
 * empty it: it shows whole, as with no search at all.
 */
async function findBatch(
    db: DB,
    userId: string,
    batchId: string | null,
    { search }: { search?: string } = {}
): Promise<LibraryBatch | undefined> {
    const searched = buildContainsPattern(search);
    let row: SummaryRow | undefined;
    if (batchId === null) {
        row = await findUngroupedRow(db, userId, searched);
    } else {
        [row] = await selectBatchSummaries(db, userId, searched).where(
            and(
                eq(schema.uploadBatches.userId, userId),
                eq(schema.uploadBatches.id, batchId)
            )
        );
    }
    if (!row) return undefined;

    const isSubset = !!searched && !row.isNameMatch && row.matchCount > 0;
    const pattern = isSubset ? searched : null;
    const [[summary], folders] = await Promise.all([
        attachCovers(db, userId, [{ ...row, isNameMatch: !isSubset }], pattern),
        findFolders(db, userId, batchId, pattern),
    ]);
    return { ...summary!, folders };
}

async function findFolders(
    db: DB,
    userId: string,
    batchId: string | null,
    pattern: string | null
): Promise<LibraryFolder[] | null> {
    const rows = await db
        .select({
            subpath: schema.files.subpath,
            fileCount: sql<number>`count(*)::int`,
            matchCount: pattern
                ? sql<number>`(count(*) filter (where ${buildFileMatch(pattern)}))::int`
                : sql<number>`0`,
        })
        .from(schema.files)
        .where(and(buildVisibleFilesFilter(userId), buildBatchFilter(batchId)))
        .groupBy(schema.files.subpath)
        .orderBy(asc(FOLDER_ORDER));
    // One place is no structure to show: the batch stays flat.
    if (rows.length <= 1) return null;
    return rows
        .filter((folder) => !pattern || folder.matchCount > 0)
        .map((folder) => ({
            subpath: folder.subpath,
            fileCount: folder.fileCount,
            matchCount: pattern ? folder.matchCount : null,
        }));
}

// Each group's cover mosaic, in one query for the whole page: its first three
// thumbnailed files in the batch's own order, filled from the rest when fewer
// than three have a thumbnail, so a batch that opens on a PDF still gets a
// photo cover. A batch in the results for its files is covered by those files.
async function attachCovers(
    db: DB,
    userId: string,
    rows: SummaryRow[],
    pattern: string | null
): Promise<LibraryBatchSummary[]> {
    if (rows.length === 0) return [];
    const batchIds = rows.flatMap((r) => (r.batchId ? [r.batchId] : []));
    const hasUngrouped = rows.some((r) => r.batchId === null);
    const wholeBatchIds = rows.flatMap((r) =>
        r.batchId && r.isNameMatch ? [r.batchId] : []
    );

    const ranked = db
        .select({
            id: schema.files.id,
            name: schema.files.name,
            thumbnailStatus: schema.files.thumbnailStatus,
            batchId: schema.files.batchId,
            rank: sql<number>`row_number() over (partition by ${schema.files.batchId} order by (${schema.files.thumbnailStatus} = 'ready') desc, ${FOLDER_ORDER}, ${NAME_ORDER}, ${schema.files.createdAt}, ${schema.files.id})`.as(
                'rank'
            ),
        })
        .from(schema.files)
        .where(
            and(
                buildVisibleFilesFilter(userId),
                or(
                    batchIds.length > 0
                        ? inArray(schema.files.batchId, batchIds)
                        : undefined,
                    hasUngrouped ? buildBatchFilter(null) : undefined
                ),
                pattern
                    ? or(
                          wholeBatchIds.length > 0
                              ? inArray(schema.files.batchId, wholeBatchIds)
                              : undefined,
                          buildFileMatch(pattern)
                      )
                    : undefined
            )
        )
        .as('ranked');
    const covers = await db
        .select({
            id: ranked.id,
            name: ranked.name,
            thumbnailStatus: ranked.thumbnailStatus,
            batchId: ranked.batchId,
        })
        .from(ranked)
        .where(lte(ranked.rank, COVER_SIZE))
        .orderBy(asc(ranked.rank));

    const coversByBatch = new Map<string | null, LibraryCoverFile[]>();
    for (const { batchId, ...cover } of covers) {
        const list = coversByBatch.get(batchId) ?? [];
        list.push(cover);
        coversByBatch.set(batchId, list);
    }

    return rows.map(({ isNameMatch, matchCount, ...row }) => ({
        ...row,
        matchCount: pattern && !isNameMatch ? matchCount : null,
        coverFiles: coversByBatch.get(row.batchId) ?? [],
    }));
}

function buildScopeFilter(userId: string, scope: BatchFilesScope): SQL {
    const pattern = buildContainsPattern(scope.search);
    // and() is only `undefined` when called with no arguments
    return and(
        buildVisibleFilesFilter(userId),
        buildBatchFilter(scope.batchId),
        buildFolderFilter(scope.folder),
        pattern ? buildFileMatch(pattern) : undefined
    )!;
}

async function selectLibraryFiles(
    db: DB,
    where: SQL | undefined,
    direction: 'asc' | 'desc',
    limit: number
): Promise<LibraryFile[]> {
    const order = direction === 'asc' ? asc : desc;
    const rows = await db
        .select({
            id: schema.files.id,
            batchId: schema.files.batchId,
            name: schema.files.name,
            subpath: schema.files.subpath,
            size: schema.files.size,
            mimeType: schema.files.mimeType,
            status: schema.files.status,
            thumbnailStatus: schema.files.thumbnailStatus,
            thumbnailWidth: schema.files.thumbnailWidth,
            thumbnailHeight: schema.files.thumbnailHeight,
            durationSeconds: schema.files.durationSeconds,
            createdAt: schema.files.createdAt,
            retrievalStatus: schema.retrievals.status,
            retrievalExpiresAt: schema.retrievals.expiresAt,
        })
        .from(schema.files)
        .leftJoin(schema.retrievals, buildActiveRetrievalJoin())
        .where(where)
        .orderBy(...FILE_ORDER.map((key) => order(key)))
        .limit(limit);
    return rows.map(({ retrievalStatus, retrievalExpiresAt, ...file }) => ({
        ...file,
        activeRetrieval: retrievalStatus
            ? { status: retrievalStatus, expiresAt: retrievalExpiresAt }
            : null,
    }));
}

// The scope's size, and how many of its files sort before `pivotId`.
async function countAround(
    db: DB,
    userId: string,
    where: SQL,
    pivotId: string | undefined
): Promise<{ total: number; before: number }> {
    const [row] = await db
        .select({
            total: sql<number>`count(*)::int`,
            before: pivotId
                ? sql<number>`(count(*) filter (where ${FILE_KEY} < ${selectFileKey(db, userId, pivotId)}))::int`
                : sql<number>`0`,
        })
        .from(schema.files)
        .where(where);
    return { total: row?.total ?? 0, before: row?.before ?? 0 };
}

/**
 * One page of a batch's files (or one of its folders', or its search
 * matches'), in natural filename order, keyset-paged both ways: forward from a
 * cursor file inclusive, backward from one exclusive. Each page says where it
 * sits, so a deep link can land mid-batch and still page back to the start.
 */
async function listBatchFiles(
    db: DB,
    userId: string,
    opts: ListBatchFilesOptions
): Promise<BatchFilesPage> {
    const { limit, cursor, direction = 'forward' } = opts;
    const where = buildScopeFilter(userId, opts);

    if (cursor && direction === 'backward') {
        const rows = await selectLibraryFiles(
            db,
            and(where, sql`${FILE_KEY} < ${selectFileKey(db, userId, cursor)}`),
            'desc',
            limit + 1
        );
        const files = rows.slice(0, limit).reverse();
        const { total, before } = await countAround(
            db,
            userId,
            where,
            files[0]?.id
        );
        return {
            files,
            startIndex: before,
            total,
            nextCursor: cursor,
            previousCursor: rows.length > limit ? files[0]!.id : null,
        };
    }

    const rows = await selectLibraryFiles(
        db,
        cursor
            ? and(
                  where,
                  sql`${FILE_KEY} >= ${selectFileKey(db, userId, cursor)}`
              )
            : where,
        'asc',
        limit + 1
    );
    const files = rows.slice(0, limit);
    // From the cursor itself when everything from it on has gone since it
    // was handed out (a deep link's page, deleted): the way back stays open.
    const pivotId = cursor ? (files[0]?.id ?? cursor) : undefined;
    const { total, before } = await countAround(db, userId, where, pivotId);
    return {
        files,
        startIndex: before,
        total,
        nextCursor: rows[limit]?.id ?? null,
        previousCursor: before > 0 && pivotId ? pivotId : null,
    };
}

/**
 * Where one of the user's visible files sits, for the `?file=` deep link: its
 * batch and folder, and the page of `pageSize` it falls on, counted from the
 * start of the section the browser lists it in (its folder, when the batch
 * has folders). Undefined for a file that isn't theirs or is gone.
 */
async function locateFile(
    db: DB,
    userId: string,
    fileId: string,
    { pageSize }: { pageSize: number }
): Promise<LocatedFile | undefined> {
    const [file] = await db
        .select({
            batchId: schema.files.batchId,
            subpath: schema.files.subpath,
        })
        .from(schema.files)
        .where(
            and(eq(schema.files.id, fileId), buildVisibleFilesFilter(userId))
        );
    if (!file) return undefined;

    const folders = await findFolders(db, userId, file.batchId, null);
    const where = buildScopeFilter(userId, {
        batchId: file.batchId,
        folder: folders ? file.subpath : undefined,
    });
    const { before } = await countAround(db, userId, where, fileId);
    const [start] = await db
        .select({ id: schema.files.id })
        .from(schema.files)
        .where(where)
        .orderBy(...FILE_ORDER.map((key) => asc(key)))
        .offset(Math.floor(before / pageSize) * pageSize)
        .limit(1);
    return { ...file, pageStartId: start?.id ?? fileId };
}

export const createLibraryRepo = createRepository({
    listBatchSummaries,
    countBatches,
    findBatch,
    listBatchFiles,
    locateFile,
});

export type LibraryRepo = ReturnType<typeof createLibraryRepo>;

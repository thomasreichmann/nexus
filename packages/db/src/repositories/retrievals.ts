import {
    eq,
    and,
    or,
    not,
    inArray,
    isNull,
    gt,
    desc,
    type SQL,
} from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type Retrieval = typeof schema.retrievals.$inferSelect;
export type NewRetrieval = typeof schema.retrievals.$inferInsert;

// A retrieval is active while it's queued, restoring, or ready with an
// unexpired download window. `ready` rows past `expiresAt` are expired by
// predicate rather than by stored status: standard-tier fast-path rows never
// get an S3 expiry event, and Deep Archive rows can miss theirs. A lapsed row
// no longer blocks a fresh retrieval of the same file.
// Exported for the files repo, which joins the active retrieval per file so
// the file list can render ready/retrieving state from the same predicate.
export function activeRetrievalFilter() {
    return or(
        inArray(schema.retrievals.status, ['pending', 'in_progress']),
        and(eq(schema.retrievals.status, 'ready'), readyWindowOpen())
    );
}

// The download window on a `ready` row is open while `expiresAt` is unset (a
// malformed restore-completed event: better a stale entry than a download cut
// off early) or still in the future. Shared with expireLapsedByFileIds so the
// active predicate and the expiry transition can't drift apart.
function readyWindowOpen(): SQL {
    // or() is only `undefined` when called with no arguments
    return or(
        isNull(schema.retrievals.expiresAt),
        gt(schema.retrievals.expiresAt, new Date())
    )!;
}

function findByFileId(db: DB, fileId: string): Promise<Retrieval | undefined> {
    return db.query.retrievals.findFirst({
        where: and(
            eq(schema.retrievals.fileId, fileId),
            activeRetrievalFilter()
        ),
    });
}

function findByFileIds(db: DB, fileIds: string[]): Promise<Retrieval[]> {
    if (fileIds.length === 0) return Promise.resolve([]);
    return db.query.retrievals.findMany({
        where: and(
            inArray(schema.retrievals.fileId, fileIds),
            activeRetrievalFilter()
        ),
    });
}

// Unfiltered lookup for S3 webhook resolution: the ObjectRestore:Delete
// event arrives at/after `expiresAt`, when the row is already invisible to
// the active-filtered queries — it must still be found to record `expired`.
function findLatestByFileId(
    db: DB,
    fileId: string
): Promise<Retrieval | undefined> {
    return db.query.retrievals.findFirst({
        where: eq(schema.retrievals.fileId, fileId),
        orderBy: desc(schema.retrievals.createdAt),
    });
}

function findByUser(db: DB, userId: string): Promise<Retrieval[]> {
    return db.query.retrievals.findMany({
        where: eq(schema.retrievals.userId, userId),
    });
}

export interface ActiveRetrievalWithFile {
    id: string;
    fileId: string;
    status: Retrieval['status'];
    tier: Retrieval['tier'];
    createdAt: Date;
    initiatedAt: Date | null;
    readyAt: Date | null;
    expiresAt: Date | null;
    fileName: string;
    fileSize: number;
}

async function findActiveByUserWithFiles(
    db: DB,
    userId: string
): Promise<ActiveRetrievalWithFile[]> {
    const rows = await db
        .select({
            id: schema.retrievals.id,
            fileId: schema.retrievals.fileId,
            status: schema.retrievals.status,
            tier: schema.retrievals.tier,
            createdAt: schema.retrievals.createdAt,
            initiatedAt: schema.retrievals.initiatedAt,
            readyAt: schema.retrievals.readyAt,
            expiresAt: schema.retrievals.expiresAt,
            fileName: schema.files.name,
            fileSize: schema.files.size,
        })
        .from(schema.retrievals)
        .innerJoin(schema.files, eq(schema.retrievals.fileId, schema.files.id))
        .where(
            and(eq(schema.retrievals.userId, userId), activeRetrievalFilter())
        )
        .orderBy(schema.retrievals.createdAt);

    return rows;
}

async function insert(db: DB, data: NewRetrieval): Promise<Retrieval> {
    const [retrieval] = await db
        .insert(schema.retrievals)
        .values(data)
        .returning();
    return retrieval;
}

// ON CONFLICT DO NOTHING against the partial unique index on active
// retrievals (retrievals_active_file_id_idx): when a concurrent request has
// already inserted an active row for a file, that row is skipped and omitted
// from the result — callers reconcile missing fileIds against the surviving
// row via findByFileIds.
async function insertMany(
    db: DB,
    dataArray: NewRetrieval[]
): Promise<Retrieval[]> {
    if (dataArray.length === 0) return [];
    return db
        .insert(schema.retrievals)
        .values(dataArray)
        .onConflictDoNothing()
        .returning();
}

// A lapsed `ready` row is inactive to reads (see activeRetrievalFilter) but
// still holds the unique-index slot for its file — the index predicate can't
// see `expiresAt`. Flip such rows to `expired` so a fresh retrieval for the
// file can insert. Idempotent, safe to race.
async function expireLapsedByFileIds(db: DB, fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await db
        .update(schema.retrievals)
        .set({ status: 'expired' })
        .where(
            and(
                inArray(schema.retrievals.fileId, fileIds),
                eq(schema.retrievals.status, 'ready'),
                not(readyWindowOpen())
            )
        );
}

async function updateStatus(
    db: DB,
    retrievalId: string,
    status: Retrieval['status'],
    metadata?: Partial<
        Omit<NewRetrieval, 'id' | 'fileId' | 'userId' | 'status'>
    >
): Promise<Retrieval | undefined> {
    const [retrieval] = await db
        .update(schema.retrievals)
        .set({ status, ...metadata })
        .where(eq(schema.retrievals.id, retrievalId))
        .returning();
    return retrieval;
}

export const createRetrievalRepo = createRepository({
    findByFileId,
    findByFileIds,
    findLatestByFileId,
    findByUser,
    findActiveByUserWithFiles,
    insert,
    insertMany,
    expireLapsedByFileIds,
    updateStatus,
});

export type RetrievalRepo = ReturnType<typeof createRetrievalRepo>;

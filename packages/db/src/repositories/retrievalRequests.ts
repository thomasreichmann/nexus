import { and, eq, inArray, isNull, not, sql, type SQL } from 'drizzle-orm';
import { ZIP_DELIVERY_MIN_FILES } from '../objectState';
import * as schema from '../schema';
import { createRepository } from './create';
import { readyAndDownloadable } from './retrievals';
import type { DB } from '../connection';

export type RetrievalRequest = typeof schema.retrievalRequests.$inferSelect;
export type NewRetrievalRequest = typeof schema.retrievalRequests.$inferInsert;

export type RetrievalRequestItem =
    typeof schema.retrievalRequestItems.$inferSelect;
export type NewRetrievalRequestItem =
    typeof schema.retrievalRequestItems.$inferInsert;

export type RetrievalArtifact = typeof schema.retrievalArtifacts.$inferSelect;
export type NewRetrievalArtifact =
    typeof schema.retrievalArtifacts.$inferInsert;

// Ids are minted by the caller (crypto.randomUUID, as everywhere else in this
// schema), so neither insert returns its row — the caller already holds every
// value it needs, and the request's timestamps have no reader yet.
async function insert(db: DB, data: NewRetrievalRequest): Promise<void> {
    await db.insert(schema.retrievalRequests).values(data);
}

async function insertItems(
    db: DB,
    items: NewRetrievalRequestItem[]
): Promise<void> {
    if (items.length === 0) return;
    await db.insert(schema.retrievalRequestItems).values(items);
}

function findByUserAndId(
    db: DB,
    userId: string,
    requestId: string
): Promise<RetrievalRequest | undefined> {
    return db.query.retrievalRequests.findFirst({
        where: and(
            eq(schema.retrievalRequests.id, requestId),
            eq(schema.retrievalRequests.userId, userId)
        ),
    });
}

/**
 * Unscoped lookup, for the worker. The user-scoped `findByUserAndId` is the
 * right default for anything reached from a request path; a restore-initiation
 * or zip job is handed its id by the queue and has no session to scope by —
 * the ownership check happened on the request path, before the job was
 * published.
 */
function findById(
    db: DB,
    requestId: string
): Promise<RetrievalRequest | undefined> {
    return db.query.retrievalRequests.findFirst({
        where: eq(schema.retrievalRequests.id, requestId),
    });
}

export interface PendingRequestRetrieval {
    retrievalId: string;
    fileId: string;
    s3Key: string;
    /** `Days` this restore was requested with; null on pre-#424 rows. */
    restoreDaysToKeep: number | null;
}

/**
 * The rows a restore-initiation job still has to ask S3 about (#423).
 *
 * The request path writes every retrieval row `pending` before the job is
 * published (#329's row-before-restore, now with the whole queue hop inside the
 * window it guards), so this is exactly the set that has a row and no answer
 * from S3 yet. Rows the request merely adopted from a restore already in flight
 * are included and cost one HEAD each: they come back `restoring`, which is the
 * same "leave it alone" the synchronous path reached by comparing states.
 *
 * Ordered so a job that dies mid-run redoes its work in the same order rather
 * than a new one, which keeps a redelivery's HEADs warm in the same rows.
 */
function findPendingRetrievals(
    db: DB,
    requestId: string
): Promise<PendingRequestRetrieval[]> {
    return db
        .select({
            retrievalId: schema.retrievals.id,
            fileId: schema.retrievals.fileId,
            s3Key: schema.files.s3Key,
            restoreDaysToKeep: schema.retrievals.restoreDaysToKeep,
        })
        .from(schema.retrievalRequestItems)
        .innerJoin(
            schema.retrievals,
            eq(schema.retrievalRequestItems.retrievalId, schema.retrievals.id)
        )
        .innerJoin(schema.files, eq(schema.retrievals.fileId, schema.files.id))
        .where(
            and(
                eq(schema.retrievalRequestItems.requestId, requestId),
                eq(schema.retrievals.status, 'pending')
            )
        )
        .orderBy(schema.retrievals.createdAt);
}

export interface RetrievalRequestReadiness {
    totalFiles: number;
    readyFiles: number;
    isReady: boolean;
}

/**
 * How much of a request can be downloaded. All-or-nothing by design (#406):
 * the request is ready when its last file thaws, so a partly ready request is
 * still not ready — `readyFiles` is there to show progress, not to release
 * files early.
 *
 * Counted over the request's items rather than over retrieval rows keyed to
 * the request: the items are what the user asked for and never change, while a
 * retrieval row may be adopted from an earlier request, lapse, or be
 * re-created for a later one. That is the property the upload-batch-keyed
 * predecessor had to reach for the batch's files to fake.
 */
async function findReadiness(
    db: DB,
    requestId: string
): Promise<RetrievalRequestReadiness> {
    // An ungrouped aggregate always yields exactly one row — a request with no
    // items counts as zero rather than vanishing — so there is no empty case
    // to fall back on here. Whether the request exists at all is the caller's
    // question, answered by findByUserAndId.
    const [row] = await db
        .select({
            totalFiles: sql<number>`count(*)::int`,
            readyFiles: sql<number>`count(*) filter (where ${readyAndDownloadable()})::int`,
        })
        .from(schema.retrievalRequestItems)
        .leftJoin(
            schema.retrievals,
            eq(schema.retrievalRequestItems.retrievalId, schema.retrievals.id)
        )
        .where(eq(schema.retrievalRequestItems.requestId, requestId));

    const { totalFiles, readyFiles } = row!;

    return {
        totalFiles,
        readyFiles,
        isReady: totalFiles > 0 && readyFiles === totalFiles,
    };
}

/**
 * Requests whose every file has thawed but which are not finished building.
 *
 * The zip pipeline's trigger, and deliberately a reconciliation rather than an
 * event. The obvious alternative — react to the rows that flipped `ready` in
 * this run — strands a request forever on any hiccup: a flipped retrieval
 * leaves the poll's `pending`/`in_progress` work list and never comes back, so
 * a partition or enqueue that failed once would never be retried by anything.
 * Asking "what still needs building?" every run is the same shape as the poll
 * itself (#416): work bounded by our own unfinished set, recomputed from
 * scratch, with no state to lose.
 *
 * It re-answers for requests already mid-build too, which is what makes a poll
 * that died between writing the partition and publishing its jobs self-heal —
 * see findPendingArtifacts.
 *
 * Single-file requests are excluded, because they are not delivered as zips —
 * `isDeliveredAsZip` is the one place that rule lives, and the request path
 * consults it too when choosing a restore window. Without the exclusion a
 * single-file restore would get both: a direct download of the restored copy
 * *and* a build nobody reads, duplicating the object in the artifacts bucket.
 *
 * `is not true` rather than `not (...)`: an item whose restore failed before
 * any retrieval row existed has a null join, and SQL's `not null` is null, so
 * the plain negation would quietly read a request with a missing file as ready.
 */
async function findBuildable(db: DB, limit: number): Promise<string[]> {
    const ready = readyAndDownloadable();
    const rows = await db
        .select({ id: schema.retrievalRequests.id })
        .from(schema.retrievalRequests)
        .where(
            and(
                isNull(schema.retrievalRequests.completedAt),
                sql`(
                    select count(*) from ${schema.retrievalRequestItems}
                    where ${schema.retrievalRequestItems.requestId} = ${schema.retrievalRequests.id}
                ) >= ${ZIP_DELIVERY_MIN_FILES}`,
                sql`not exists (
                    select 1 from ${schema.retrievalRequestItems}
                    left join ${schema.retrievals}
                        on ${schema.retrievals.id} = ${schema.retrievalRequestItems.retrievalId}
                    where ${schema.retrievalRequestItems.requestId} = ${schema.retrievalRequests.id}
                      and (${ready}) is not true
                )`
            )
        )
        .orderBy(schema.retrievalRequests.createdAt)
        .limit(limit);
    return rows.map((row) => row.id);
}

/** One file of a request, with what the partition and the zip writer need. */
export interface RetrievalRequestFile {
    fileId: string;
    s3Key: string;
    /** Original upload name — the entry name inside the zip. */
    name: string;
    size: number;
    /** Upload time, written as the zip entry's modification time. */
    createdAt: Date;
}

/**
 * The files behind some set of request items, in zip order.
 *
 * Ordered by `s3Key` rather than by name: the key embeds the upload batch, so
 * sorting on it keeps files that were uploaded together adjacent, and the
 * partition's next-fit walk turns that adjacency into "one shoot per zip"
 * instead of scattering a folder across chunks. Name alone would interleave
 * identically-named files from different batches.
 *
 * Shared by the two callers below so the ordering is defined once — the
 * partition and the zip writer disagreeing about it would put files in a
 * different archive than the one they were packed for.
 */
function selectFilesWhere(db: DB, where: SQL): Promise<RetrievalRequestFile[]> {
    return db
        .select({
            fileId: schema.files.id,
            s3Key: schema.files.s3Key,
            name: schema.files.name,
            size: schema.files.size,
            createdAt: schema.files.createdAt,
        })
        .from(schema.retrievalRequestItems)
        .innerJoin(
            schema.files,
            eq(schema.retrievalRequestItems.fileId, schema.files.id)
        )
        .where(where)
        .orderBy(schema.files.s3Key);
}

/** Everything a request asked for, the input to the partition. */
function findFiles(db: DB, requestId: string): Promise<RetrievalRequestFile[]> {
    return selectFilesWhere(
        db,
        eq(schema.retrievalRequestItems.requestId, requestId)
    );
}

/**
 * The files a built artifact must contain, in zip order — by `s3Key`, the same
 * walk the partition used, so the entries come out in the order the chunking
 * assumed.
 */
function findArtifactFiles(
    db: DB,
    artifactId: string
): Promise<RetrievalRequestFile[]> {
    return selectFilesWhere(
        db,
        eq(schema.retrievalRequestItems.artifactId, artifactId)
    );
}

function findArtifactById(
    db: DB,
    artifactId: string
): Promise<RetrievalArtifact | undefined> {
    return db.query.retrievalArtifacts.findFirst({
        where: eq(schema.retrievalArtifacts.id, artifactId),
    });
}

/**
 * Write a request's partition, skipping chunks that already exist.
 *
 * ON CONFLICT DO NOTHING against `retrieval_artifacts_request_id_position_idx`,
 * so a poll that crashed between inserting the artifacts and enqueueing their
 * jobs re-runs harmlessly. The return value is deliberately not the caller's
 * enqueue list — see findPendingArtifacts, which covers the rows a previous run
 * inserted but never enqueued.
 */
async function insertArtifacts(
    db: DB,
    rows: NewRetrievalArtifact[]
): Promise<RetrievalArtifact[]> {
    if (rows.length === 0) return [];
    return db
        .insert(schema.retrievalArtifacts)
        .values(rows)
        .onConflictDoNothing()
        .returning();
}

/** Point a chunk's files at the artifact that will contain them. */
async function assignItemsToArtifact(
    db: DB,
    requestId: string,
    artifactId: string,
    fileIds: string[]
): Promise<void> {
    if (fileIds.length === 0) return;
    await db
        .update(schema.retrievalRequestItems)
        .set({ artifactId })
        .where(
            and(
                eq(schema.retrievalRequestItems.requestId, requestId),
                inArray(schema.retrievalRequestItems.fileId, fileIds)
            )
        );
}

/**
 * A request's artifacts, in part order.
 *
 * Answers both of the partition's questions in one read: whether this request
 * has been partitioned at all, and which of its chunks still need a build job.
 * The second is why the caller can't just use what `insertArtifacts` returned —
 * after a crash mid-enqueue the rows already exist, so the insert conflicts
 * away and returns nothing while the jobs were never sent. A duplicate message
 * is the cheaper failure; `claimArtifact` settles it.
 */
async function findArtifacts(
    db: DB,
    requestId: string
): Promise<RetrievalArtifact[]> {
    return db.query.retrievalArtifacts.findMany({
        where: eq(schema.retrievalArtifacts.requestId, requestId),
        orderBy: schema.retrievalArtifacts.position,
    });
}

/**
 * Take ownership of an artifact for a build attempt.
 *
 * Anything but `ready` is claimable, which covers all three ways a job arrives
 * at an artifact someone else has touched: a fresh `pending` chunk, a `failed`
 * one being retried, and a `building` one abandoned by a container that died
 * mid-stream (SQS redelivers the message, but nothing would ever release the
 * status). Excluding `ready` is what makes a duplicate delivery after a
 * successful build a no-op instead of a second 4 GB upload.
 */
async function claimArtifact(
    db: DB,
    artifactId: string
): Promise<RetrievalArtifact | undefined> {
    const [artifact] = await db
        .update(schema.retrievalArtifacts)
        .set({
            status: 'building',
            startedAt: new Date(),
            attempts: sql`${schema.retrievalArtifacts.attempts} + 1`,
        })
        .where(
            and(
                eq(schema.retrievalArtifacts.id, artifactId),
                not(eq(schema.retrievalArtifacts.status, 'ready'))
            )
        )
        .returning();
    return artifact;
}

async function completeArtifact(
    db: DB,
    artifactId: string,
    result: { s3Key: string; sizeBytes: number }
): Promise<RetrievalArtifact | undefined> {
    const [artifact] = await db
        .update(schema.retrievalArtifacts)
        .set({
            status: 'ready',
            s3Key: result.s3Key,
            sizeBytes: result.sizeBytes,
            completedAt: new Date(),
            // Clear the previous attempt's message: the row now describes a zip
            // that exists, and a stale error reads as a broken artifact.
            error: null,
        })
        .where(eq(schema.retrievalArtifacts.id, artifactId))
        .returning();
    return artifact;
}

async function failArtifact(
    db: DB,
    artifactId: string,
    error: string
): Promise<void> {
    await db
        .update(schema.retrievalArtifacts)
        .set({ status: 'failed', error })
        .where(
            and(
                eq(schema.retrievalArtifacts.id, artifactId),
                eq(schema.retrievalArtifacts.status, 'building')
            )
        );
}

/**
 * Flip a request complete if this was its last artifact, in one statement.
 *
 * The concurrency-safe half of #424's aggregation. Every zip job calls this
 * after committing its own artifact as `ready`, so the job that commits last
 * is the only one whose snapshot can see a fully-ready set — and the
 * `completedAt IS NULL` guard means that even if two somehow did, exactly one
 * row comes back. That single winner is what #426 will send one email on.
 *
 * The NOT EXISTS is what keeps the stored flag honest: `completed_at` can only
 * ever be written while every artifact of the request is `ready`.
 */
async function completeIfArtifactsReady(
    db: DB,
    requestId: string
): Promise<RetrievalRequest | undefined> {
    const [request] = await db
        .update(schema.retrievalRequests)
        .set({ completedAt: new Date() })
        .where(
            and(
                eq(schema.retrievalRequests.id, requestId),
                isNull(schema.retrievalRequests.completedAt),
                sql`not exists (
                    select 1 from ${schema.retrievalArtifacts}
                    where ${schema.retrievalArtifacts.requestId} = ${requestId}
                      and ${schema.retrievalArtifacts.status} <> 'ready'
                )`
            )
        )
        .returning();
    return request;
}

export const createRetrievalRequestRepo = createRepository({
    insert,
    insertItems,
    findById,
    findByUserAndId,
    findById,
    findPendingRetrievals,
    findReadiness,
    findBuildable,
    findFiles,
    findArtifactFiles,
    findArtifactById,
    insertArtifacts,
    assignItemsToArtifact,
    findArtifacts,
    claimArtifact,
    completeArtifact,
    failArtifact,
    completeIfArtifactsReady,
});

export type RetrievalRequestRepo = ReturnType<
    typeof createRetrievalRequestRepo
>;

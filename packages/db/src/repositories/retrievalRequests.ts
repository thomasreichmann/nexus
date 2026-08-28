import { and, eq, sql } from 'drizzle-orm';
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

export const createRetrievalRequestRepo = createRepository({
    insert,
    insertItems,
    findByUserAndId,
    findReadiness,
});

export type RetrievalRequestRepo = ReturnType<
    typeof createRetrievalRequestRepo
>;

import { eq, and, desc, gt, isNotNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as schema from '../schema';
import { createRepository } from './create';
import { STALE_UPLOAD_HOURS } from './files';
import type { DB } from '../connection';

export type UploadBatch = typeof schema.uploadBatches.$inferSelect;
type NewUploadBatch = typeof schema.uploadBatches.$inferInsert;

/**
 * How long a batch must have been quiet before its missing files count as
 * lost rather than still on their way.
 */
export const PARTIAL_QUIET_HOURS = 1;

const batchFile = alias(schema.files, 'batch_file');

// A file the batch received: stamped when its upload was confirmed, or still
// up from before the stamp existed. Deleted since or not.
const IS_RECEIVED = sql`(${batchFile.confirmedAt} is not null or ${batchFile.status} in ('available', 'restoring'))`;

/**
 * How many files of the batch were received (`IS_RECEIVED`). Correlated like
 * `buildMissingFileCount`.
 */
export function buildReceivedFileCount(): SQL<number> {
    return sql<number>`(
        select count(*) filter (where ${IS_RECEIVED})
        from ${schema.files} ${batchFile}
        where ${batchFile.batchId} = ${schema.uploadBatches.id}
    )::int`;
}

/**
 * How many files a batch came up short (#550): the files its Upload click
 * sent (`expected_file_count`, #399) less the ones it received, deleted since
 * or not. The user deleting a file doesn't make a batch short; a wave that
 * died does.
 *
 * Zero while that can't be told yet:
 * - a file still `uploading`, for less than STALE_UPLOAD_HOURS: one large
 *   multipart upload runs for hours with nothing on any row to show for it,
 *   and the files queued behind it have no row at all. A tab closed mid-wave
 *   leaves its rows `uploading` for good (nothing reaps them on a schedule),
 *   so those stop holding the batch back once they're stale;
 * - anything created or received in the last PARTIAL_QUIET_HOURS: between
 *   files, a running wave has nothing uploading;
 * - no expectation recorded.
 *
 * A resumable upload that lands later just brings the count down.
 *
 * Correlated on the outer query's `upload_batches` row, for a joined query's
 * select list or a WHERE (a select list with no join drops the alias from
 * each column).
 */
export function buildMissingFileCount(): SQL<number> {
    const now = Date.now();
    const quietSince = new Date(now - PARTIAL_QUIET_HOURS * 3_600_000);
    const staleBefore = new Date(now - STALE_UPLOAD_HOURS * 3_600_000);
    return sql<number>`(
        select case
            when count(*) filter (
                    where ${batchFile.status} = 'uploading'
                        and ${batchFile.createdAt} >= ${staleBefore.toISOString()}::timestamptz
                ) = 0
                and greatest(
                    ${schema.uploadBatches.createdAt},
                    max(${batchFile.createdAt}),
                    max(${batchFile.confirmedAt})
                ) < ${quietSince.toISOString()}::timestamptz
            then greatest(
                ${schema.uploadBatches.expectedFileCount}
                    - count(*) filter (where ${IS_RECEIVED}),
                0
            )
            else 0
        end
        from ${schema.files} ${batchFile}
        where ${batchFile.batchId} = ${schema.uploadBatches.id}
    )::int`;
}

function findByUserAndId(
    db: DB,
    userId: string,
    batchId: string
): Promise<UploadBatch | undefined> {
    return db.query.uploadBatches.findFirst({
        where: and(
            eq(schema.uploadBatches.id, batchId),
            eq(schema.uploadBatches.userId, userId)
        ),
    });
}

async function insert(db: DB, data: NewUploadBatch): Promise<UploadBatch> {
    const [batch] = await db
        .insert(schema.uploadBatches)
        .values(data)
        .returning();
    return batch;
}

/** Renames one of the user's batches; undefined when it isn't theirs. */
async function rename(
    db: DB,
    userId: string,
    batchId: string,
    name: string
): Promise<UploadBatch | undefined> {
    const [batch] = await db
        .update(schema.uploadBatches)
        .set({ name })
        .where(
            and(
                eq(schema.uploadBatches.id, batchId),
                eq(schema.uploadBatches.userId, userId)
            )
        )
        .returning();
    return batch;
}

/** A batch that came up short, as the admin Uploads page lists it (#550). */
export interface PartialBatch {
    batchId: string;
    name: string;
    createdAt: Date;
    userId: string;
    userEmail: string;
    expectedFileCount: number;
    receivedFileCount: number;
    missingFileCount: number;
}

export interface PartialBatchPage {
    batches: PartialBatch[];
    total: number;
}

/** Every user's partial batches (`buildMissingFileCount`), newest first. */
async function listPartial(
    db: DB,
    { limit, offset }: { limit: number; offset: number }
): Promise<PartialBatchPage> {
    const isPartial = and(
        isNotNull(schema.uploadBatches.expectedFileCount),
        gt(buildMissingFileCount(), 0)
    );
    const [batches, [counted]] = await Promise.all([
        db
            .select({
                batchId: schema.uploadBatches.id,
                name: schema.uploadBatches.name,
                createdAt: schema.uploadBatches.createdAt,
                userId: schema.uploadBatches.userId,
                userEmail: schema.user.email,
                // Not null: the WHERE requires it.
                expectedFileCount: sql<number>`${schema.uploadBatches.expectedFileCount}`,
                receivedFileCount: buildReceivedFileCount(),
                missingFileCount: buildMissingFileCount(),
            })
            .from(schema.uploadBatches)
            .innerJoin(
                schema.user,
                eq(schema.user.id, schema.uploadBatches.userId)
            )
            .where(isPartial)
            .orderBy(
                desc(schema.uploadBatches.createdAt),
                desc(schema.uploadBatches.id)
            )
            .limit(limit)
            .offset(offset),
        db
            .select({ total: sql<number>`count(*)::int` })
            .from(schema.uploadBatches)
            .where(isPartial),
    ]);
    return { batches, total: counted?.total ?? 0 };
}

export const createUploadBatchRepo = createRepository({
    findByUserAndId,
    insert,
    rename,
    listPartial,
});

export type UploadBatchRepo = ReturnType<typeof createUploadBatchRepo>;

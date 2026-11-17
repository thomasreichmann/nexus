import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { createRepository } from './create';
import type { DB } from '../connection';

export type Share = typeof schema.shares.$inferSelect;
export type NewShare = typeof schema.shares.$inferInsert;
export type ShareFile = typeof schema.shareFiles.$inferSelect;
export type NewShareFile = typeof schema.shareFiles.$inferInsert;

export interface ShareWithFiles extends Share {
    files: ShareFile[];
}

/** What one uploader, and everyone together, created inside a window. */
export interface ShareUsage {
    ipShares: number;
    ipBytes: number;
    globalBytes: number;
}

async function insert(
    db: DB,
    share: NewShare,
    files: NewShareFile[]
): Promise<Share> {
    const [inserted] = await db.insert(schema.shares).values(share).returning();
    await db.insert(schema.shareFiles).values(files);
    return inserted;
}

/**
 * Take this uploader's creation lock for the rest of the transaction, without
 * waiting. `false` means another creation from the same uploader holds it.
 *
 * It makes "read usage, then insert" atomic per uploader, so a burst of
 * parallel requests can't all pass the same limit check. It doesn't wait
 * because a waiter holds a pooled connection, and a queue of them is how an
 * anonymous caller would starve the pool for everyone else.
 */
async function tryLockUploader(db: DB, ipHash: string): Promise<boolean> {
    const [row] = await db.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${`share:${ipHash}`}, 0)) as locked`
    );
    return row?.locked === true;
}

/**
 * Usage by shares created after `since`, whatever their status: an upload URL
 * was issued for every one of them, so every one may hold bytes.
 */
async function usageSince(
    db: DB,
    ipHash: string,
    since: Date
): Promise<ShareUsage> {
    const isUploader = eq(schema.shares.ipHash, ipHash);
    const [row] = await db
        .select({
            ipShares: sql<number>`count(*) filter (where ${isUploader})::int`,
            ipBytes: sql<string>`coalesce(sum(${schema.shares.totalSize}) filter (where ${isUploader}), 0)`,
            globalBytes: sql<string>`coalesce(sum(${schema.shares.totalSize}), 0)`,
        })
        .from(schema.shares)
        .where(gt(schema.shares.createdAt, since));

    return {
        ipShares: row?.ipShares ?? 0,
        ipBytes: Number(row?.ipBytes ?? 0),
        globalBytes: Number(row?.globalBytes ?? 0),
    };
}

async function findWithFiles(
    db: DB,
    id: string
): Promise<ShareWithFiles | undefined> {
    const share = await db.query.shares.findFirst({
        where: eq(schema.shares.id, id),
    });
    if (!share) return undefined;
    return { ...share, files: await findFiles(db, id) };
}

/**
 * The share as a downloader may see it: finished uploading and not yet expired.
 * Strict `gt`, so a link stops working the instant it reaches `expiresAt`.
 */
async function findActive(
    db: DB,
    id: string,
    now: Date = new Date()
): Promise<ShareWithFiles | undefined> {
    const share = await db.query.shares.findFirst({
        where: and(
            eq(schema.shares.id, id),
            eq(schema.shares.status, 'ready'),
            gt(schema.shares.expiresAt, now)
        ),
    });
    if (!share) return undefined;
    return { ...share, files: await findFiles(db, id) };
}

/**
 * Flip an uploading, unexpired share to `ready`. `undefined` when it isn't
 * one: already ready, expired, or not there.
 */
async function markReady(
    db: DB,
    id: string,
    now: Date = new Date()
): Promise<Share | undefined> {
    const [share] = await db
        .update(schema.shares)
        .set({ status: 'ready' })
        .where(
            and(
                eq(schema.shares.id, id),
                eq(schema.shares.status, 'uploading'),
                gt(schema.shares.expiresAt, now)
            )
        )
        .returning();
    return share;
}

/**
 * Count one download of the file, unless it has already had `limit`. The
 * check and the increment are one statement, so concurrent downloads can't
 * take the count past the limit. `undefined` means the limit is reached (or
 * the file isn't there).
 */
async function claimDownload(
    db: DB,
    fileId: string,
    limit: number
): Promise<ShareFile | undefined> {
    const [file] = await db
        .update(schema.shareFiles)
        .set({ downloadCount: sql`${schema.shareFiles.downloadCount} + 1` })
        .where(
            and(
                eq(schema.shareFiles.id, fileId),
                lt(schema.shareFiles.downloadCount, limit)
            )
        )
        .returning();
    return file;
}

function findFiles(db: DB, shareId: string): Promise<ShareFile[]> {
    return db.query.shareFiles.findMany({
        where: eq(schema.shareFiles.shareId, shareId),
        orderBy: asc(schema.shareFiles.position),
    });
}

export const createShareRepo = createRepository({
    insert,
    tryLockUploader,
    usageSince,
    findWithFiles,
    findActive,
    markReady,
    claimDownload,
});

export type ShareRepo = ReturnType<typeof createShareRepo>;

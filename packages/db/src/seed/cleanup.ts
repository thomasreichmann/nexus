import { like, eq, and, not, count, sum, sql } from 'drizzle-orm';
import * as schema from '../schema';
import type { DB } from '../connection';
import type { CleanupResult, SeedSummary } from './types';
import {
    SEED_PREFIX,
    SEED_FILE_PREFIX,
    SEED_USER_PREFIX,
    withTransaction,
} from './constants';

// Summary

export async function getSeedSummary(db: DB): Promise<SeedSummary> {
    // Count all seed-prefixed entities across all users (real + fake)
    const [fileStats] = await db
        .select({
            count: count(),
            totalBytes: sum(schema.files.size).mapWith(Number),
        })
        .from(schema.files)
        .where(like(schema.files.id, `${SEED_PREFIX}%`));

    const [retCount] = await db
        .select({ count: count() })
        .from(schema.retrievals)
        .where(like(schema.retrievals.id, `${SEED_PREFIX}%`));

    const [seedUserCount] = await db
        .select({ count: count() })
        .from(schema.user)
        .where(like(schema.user.id, `${SEED_PREFIX}%`));

    const [subCount] = await db
        .select({ count: count() })
        .from(schema.subscriptions)
        .where(like(schema.subscriptions.id, `${SEED_PREFIX}%`));

    // Per-user seed file counts — includes ALL users that have seed files
    const userDetails = await db
        .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            fileCount: count(schema.files.id),
        })
        .from(schema.user)
        .innerJoin(
            schema.files,
            and(
                eq(schema.files.userId, schema.user.id),
                like(schema.files.id, `${SEED_PREFIX}%`)
            )
        )
        .groupBy(schema.user.id, schema.user.name, schema.user.email);

    return {
        users: seedUserCount?.count ?? 0,
        files: fileStats?.count ?? 0,
        subscriptions: subCount?.count ?? 0,
        retrievals: retCount?.count ?? 0,
        totalBytes: fileStats?.totalBytes ?? 0,
        userDetails,
    };
}

/** List all real (non-seed) users for the user picker */
export async function listAllUsers(
    db: DB
): Promise<{ id: string; name: string; email: string }[]> {
    return db
        .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
        })
        .from(schema.user)
        .where(not(like(schema.user.id, `${SEED_USER_PREFIX}%`)));
}

// Cleanup functions
// Delete order respects FK constraints: retrievals → files → storageUsage → subscriptions → users

export async function cleanupAll(db: DB): Promise<CleanupResult> {
    return withTransaction(db, async (tx) => {
        const deletedRetrievals = await tx
            .delete(schema.retrievals)
            .where(like(schema.retrievals.id, `${SEED_PREFIX}%`))
            .returning();

        const deletedFiles = await tx
            .delete(schema.files)
            .where(like(schema.files.id, `${SEED_PREFIX}%`))
            .returning();

        const deletedStorageUsage = await tx
            .delete(schema.storageUsage)
            .where(like(schema.storageUsage.id, `${SEED_PREFIX}%`))
            .returning();

        const deletedSubscriptions = await tx
            .delete(schema.subscriptions)
            .where(like(schema.subscriptions.id, `${SEED_PREFIX}%`))
            .returning();

        const deletedUsers = await tx
            .delete(schema.user)
            .where(like(schema.user.id, `${SEED_PREFIX}%`))
            .returning();

        return {
            deletedUsers: deletedUsers.length,
            deletedFiles: deletedFiles.length,
            deletedSubscriptions: deletedSubscriptions.length,
            deletedRetrievals: deletedRetrievals.length,
            deletedStorageUsage: deletedStorageUsage.length,
        };
    });
}

export async function cleanupFiles(db: DB): Promise<CleanupResult> {
    return withTransaction(db, async (tx) => {
        // Delete retrievals that reference seed files first
        const seedFileIds = tx
            .select({ id: schema.files.id })
            .from(schema.files)
            .where(like(schema.files.id, `${SEED_FILE_PREFIX}%`));

        const deletedRetrievals = await tx
            .delete(schema.retrievals)
            .where(sql`${schema.retrievals.fileId} IN (${seedFileIds})`)
            .returning();

        const deletedFiles = await tx
            .delete(schema.files)
            .where(like(schema.files.id, `${SEED_FILE_PREFIX}%`))
            .returning();

        // Update storage usage for affected seed users
        const deletedStorageUsage = await tx
            .delete(schema.storageUsage)
            .where(like(schema.storageUsage.id, `${SEED_PREFIX}%`))
            .returning();

        return {
            deletedUsers: 0,
            deletedFiles: deletedFiles.length,
            deletedSubscriptions: 0,
            deletedRetrievals: deletedRetrievals.length,
            deletedStorageUsage: deletedStorageUsage.length,
        };
    });
}

/**
 * Remove only seed-prefixed files and retrievals for a given user.
 * Safe for real users — never deletes the user record or subscription.
 */
export async function cleanupSeedDataForUser(
    db: DB,
    userId: string
): Promise<CleanupResult> {
    return withTransaction(db, async (tx) => {
        const deletedRetrievals = await tx
            .delete(schema.retrievals)
            .where(
                and(
                    eq(schema.retrievals.userId, userId),
                    like(schema.retrievals.id, `${SEED_PREFIX}%`)
                )
            )
            .returning();

        const deletedFiles = await tx
            .delete(schema.files)
            .where(
                and(
                    eq(schema.files.userId, userId),
                    like(schema.files.id, `${SEED_PREFIX}%`)
                )
            )
            .returning();

        return {
            deletedUsers: 0,
            deletedFiles: deletedFiles.length,
            deletedSubscriptions: 0,
            deletedRetrievals: deletedRetrievals.length,
            deletedStorageUsage: 0,
        };
    });
}

/**
 * Remove a seed user and ALL their data (including any non-seed-prefixed rows).
 * Only works for seed-prefixed user IDs. Since the user record itself is
 * deleted, we intentionally remove everything — leaving orphaned rows for a
 * deleted user would be worse than over-deleting.
 */
export async function cleanupByUser(
    db: DB,
    userId: string
): Promise<CleanupResult> {
    if (!userId.startsWith(SEED_USER_PREFIX)) {
        throw new Error(`Refusing to delete non-seed user: ${userId}`);
    }

    return withTransaction(db, async (tx) => {
        const deletedRetrievals = await tx
            .delete(schema.retrievals)
            .where(eq(schema.retrievals.userId, userId))
            .returning();

        const deletedFiles = await tx
            .delete(schema.files)
            .where(eq(schema.files.userId, userId))
            .returning();

        const deletedStorageUsage = await tx
            .delete(schema.storageUsage)
            .where(eq(schema.storageUsage.userId, userId))
            .returning();

        const deletedSubscriptions = await tx
            .delete(schema.subscriptions)
            .where(eq(schema.subscriptions.userId, userId))
            .returning();

        const deletedUsers = await tx
            .delete(schema.user)
            .where(eq(schema.user.id, userId))
            .returning();

        return {
            deletedUsers: deletedUsers.length,
            deletedFiles: deletedFiles.length,
            deletedSubscriptions: deletedSubscriptions.length,
            deletedRetrievals: deletedRetrievals.length,
            deletedStorageUsage: deletedStorageUsage.length,
        };
    });
}

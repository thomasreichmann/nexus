import { eq, sql } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type StorageUsage = typeof schema.storageUsage.$inferSelect;

export interface UsageSnapshot {
    usedBytes: number;
    fileCount: number;
}

const ZERO_USAGE: UsageSnapshot = { usedBytes: 0, fileCount: 0 };

async function getUsage(db: DB, userId: string): Promise<UsageSnapshot> {
    const row = await db.query.storageUsage.findFirst({
        where: eq(schema.storageUsage.userId, userId),
    });
    if (!row) return ZERO_USAGE;
    return { usedBytes: Number(row.usedBytes), fileCount: row.fileCount };
}

// Atomic upsert: increments usage in-place when a row exists, inserts a fresh
// row at `bytes` for first-time uploaders. Postgres handles concurrent calls
// without read-modify-write races thanks to the `+ EXCLUDED.*` set clause.
async function incrementUsage(
    db: DB,
    userId: string,
    bytes: number
): Promise<UsageSnapshot> {
    const [row] = await db
        .insert(schema.storageUsage)
        .values({
            id: crypto.randomUUID(),
            userId,
            usedBytes: bytes,
            fileCount: 1,
        })
        .onConflictDoUpdate({
            target: schema.storageUsage.userId,
            set: {
                usedBytes: sql`${schema.storageUsage.usedBytes} + ${bytes}`,
                fileCount: sql`${schema.storageUsage.fileCount} + 1`,
                updatedAt: new Date(),
            },
        })
        .returning();
    return { usedBytes: Number(row.usedBytes), fileCount: row.fileCount };
}

// Decrement clamps at 0 to defend against drift (decrement without a prior
// increment would otherwise produce a negative value, which the bigint column
// would happily store but no caller can interpret meaningfully). Accepts
// fileCount so a multi-file delete can issue a single UPDATE.
async function decrementUsage(
    db: DB,
    userId: string,
    bytes: number,
    fileCount: number = 1
): Promise<UsageSnapshot> {
    const [row] = await db
        .update(schema.storageUsage)
        .set({
            usedBytes: sql`GREATEST(${schema.storageUsage.usedBytes} - ${bytes}, 0)`,
            fileCount: sql`GREATEST(${schema.storageUsage.fileCount} - ${fileCount}, 0)`,
            updatedAt: new Date(),
        })
        .where(eq(schema.storageUsage.userId, userId))
        .returning();
    if (!row) return ZERO_USAGE;
    return { usedBytes: Number(row.usedBytes), fileCount: row.fileCount };
}

export const createStorageUsageRepo = createRepository({
    getUsage,
    incrementUsage,
    decrementUsage,
});

export type StorageUsageRepo = ReturnType<typeof createStorageUsageRepo>;

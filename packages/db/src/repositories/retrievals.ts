import { eq, and, inArray } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';
import { createRepository } from './create';

export type Retrieval = typeof schema.retrievals.$inferSelect;
export type NewRetrieval = typeof schema.retrievals.$inferInsert;

// 'ready' included because the restored copy is still available for download
const ACTIVE_STATUSES: Retrieval['status'][] = [
    'pending',
    'in_progress',
    'ready',
];

function findByFileId(db: DB, fileId: string): Promise<Retrieval | undefined> {
    return db.query.retrievals.findFirst({
        where: and(
            eq(schema.retrievals.fileId, fileId),
            inArray(schema.retrievals.status, ACTIVE_STATUSES)
        ),
    });
}

function findByFileIds(db: DB, fileIds: string[]): Promise<Retrieval[]> {
    if (fileIds.length === 0) return Promise.resolve([]);
    return db.query.retrievals.findMany({
        where: and(
            inArray(schema.retrievals.fileId, fileIds),
            inArray(schema.retrievals.status, ACTIVE_STATUSES)
        ),
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
            and(
                eq(schema.retrievals.userId, userId),
                inArray(schema.retrievals.status, ACTIVE_STATUSES)
            )
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

async function insertMany(
    db: DB,
    dataArray: NewRetrieval[]
): Promise<Retrieval[]> {
    if (dataArray.length === 0) return [];
    return db.insert(schema.retrievals).values(dataArray).returning();
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
    findByUser,
    findActiveByUserWithFiles,
    insert,
    insertMany,
    updateStatus,
});

export type RetrievalRepo = ReturnType<typeof createRetrievalRepo>;

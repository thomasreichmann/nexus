import { eq, and, inArray } from 'drizzle-orm';
import type { DB } from '../connection';
import * as schema from '../schema';

export type Retrieval = typeof schema.retrievals.$inferSelect;
export type NewRetrieval = typeof schema.retrievals.$inferInsert;

// 'ready' included because the restored copy is still available for download
const ACTIVE_STATUSES: Retrieval['status'][] = [
    'pending',
    'in_progress',
    'ready',
];

export function findByFileId(
    db: DB,
    fileId: string
): Promise<Retrieval | undefined> {
    return db.query.retrievals.findFirst({
        where: and(
            eq(schema.retrievals.fileId, fileId),
            inArray(schema.retrievals.status, ACTIVE_STATUSES)
        ),
    });
}

export function findByFileIds(db: DB, fileIds: string[]): Promise<Retrieval[]> {
    if (fileIds.length === 0) return Promise.resolve([]);
    return db.query.retrievals.findMany({
        where: and(
            inArray(schema.retrievals.fileId, fileIds),
            inArray(schema.retrievals.status, ACTIVE_STATUSES)
        ),
    });
}

export function findByUser(db: DB, userId: string): Promise<Retrieval[]> {
    return db.query.retrievals.findMany({
        where: eq(schema.retrievals.userId, userId),
    });
}

export async function insert(db: DB, data: NewRetrieval): Promise<Retrieval> {
    const [retrieval] = await db
        .insert(schema.retrievals)
        .values(data)
        .returning();
    return retrieval;
}

export async function insertMany(
    db: DB,
    dataArray: NewRetrieval[]
): Promise<Retrieval[]> {
    if (dataArray.length === 0) return [];
    return db.insert(schema.retrievals).values(dataArray).returning();
}

export async function updateStatus(
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

export function createRetrievalRepo(db: DB) {
    return {
        findByFileId: (fileId: string) => findByFileId(db, fileId),
        findByFileIds: (fileIds: string[]) => findByFileIds(db, fileIds),
        findByUser: (userId: string) => findByUser(db, userId),
        insert: (data: NewRetrieval) => insert(db, data),
        insertMany: (dataArray: NewRetrieval[]) => insertMany(db, dataArray),
        updateStatus: (
            retrievalId: string,
            status: Retrieval['status'],
            metadata?: Partial<
                Omit<NewRetrieval, 'id' | 'fileId' | 'userId' | 'status'>
            >
        ) => updateStatus(db, retrievalId, status, metadata),
    };
}
export type RetrievalRepo = ReturnType<typeof createRetrievalRepo>;

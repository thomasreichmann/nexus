import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { createRepository } from './create';
import type { DB } from '../connection';

export type UploadBatch = typeof schema.uploadBatches.$inferSelect;
type NewUploadBatch = typeof schema.uploadBatches.$inferInsert;

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

export const createUploadBatchRepo = createRepository({
    findByUserAndId,
    insert,
});

export type UploadBatchRepo = ReturnType<typeof createUploadBatchRepo>;

import { count, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { it, expect, describe, inRolledBackTransaction } from './integration';
import { insertUploadBatch } from './inserts';
import type { DB } from '../connection';

async function countBatches(db: DB, userId: string) {
    const [row] = await db
        .select({ count: count() })
        .from(schema.uploadBatches)
        .where(eq(schema.uploadBatches.userId, userId));
    return row!.count;
}

// A test that checks one whole-table read against another needs them to see
// the same rows, whatever the rest of the suite commits between them (#543).
describe('inRolledBackTransaction', () => {
    it('reads one snapshot, even across a row another connection commits', ({
        db,
        user,
    }) =>
        inRolledBackTransaction(db, async (tx) => {
            const before = await countBatches(tx, user.id);

            await insertUploadBatch(db, { userId: user.id });

            expect(await countBatches(tx, user.id)).toBe(before);
        }));
});

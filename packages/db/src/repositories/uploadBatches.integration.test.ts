import { it, expect, describe } from '../test-db/integration';
import { insertUploadBatch } from '../test-db';
import { createUploadBatchRepo } from './uploadBatches';

// The reference repository test (docs/conventions/testing.md): real rows,
// including one each term of the predicate must exclude, and an assertion on
// what the query returns. A mocked `findFirst` returns whatever the test told
// it to, so it could never see either filter below go missing (#489, #524).
describe('findByUserAndId', () => {
    // Asking for each of two batches: without the id term, both lookups get
    // the same one back, whichever row Postgres finds first.
    it('returns the batch asked for, not the owner’s other one', async ({
        db,
        user,
    }) => {
        const [a, b] = await Promise.all([
            insertUploadBatch(db, { userId: user.id }),
            insertUploadBatch(db, { userId: user.id }),
        ]);
        const repo = createUploadBatchRepo(db);

        expect((await repo.findByUserAndId(user.id, a.id))?.id).toBe(a.id);
        expect((await repo.findByUserAndId(user.id, b.id))?.id).toBe(b.id);
    });

    it('does not return another user’s batch, even by its id', async ({
        db,
        user,
        createUser,
    }) => {
        const owner = await createUser();
        const batch = await insertUploadBatch(db, { userId: owner.id });

        const found = await createUploadBatchRepo(db).findByUserAndId(
            user.id,
            batch.id
        );

        expect(found).toBeUndefined();
    });
});

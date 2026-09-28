import { it, expect, describe } from '../test-db/integration';
import { insertUploadBatch } from '../test-db';
import { createUploadBatchRepo } from './uploadBatches';

// The reference repository test (docs/conventions/testing.md): real rows,
// including the one the predicate must exclude, and an assertion on what the
// query returns. A mocked `findFirst` returns whatever the test told it to,
// so it could never see the ownership filter below go missing (#489).
describe('findByUserAndId', () => {
    it('returns the batch to its owner', async ({ db, user }) => {
        const batch = await insertUploadBatch(db, { userId: user.id });

        const found = await createUploadBatchRepo(db).findByUserAndId(
            user.id,
            batch.id
        );

        expect(found?.id).toBe(batch.id);
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

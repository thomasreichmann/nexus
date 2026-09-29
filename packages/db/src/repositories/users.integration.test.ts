import { it, expect, describe } from '../test-db/integration';
import { createUserRepo } from './users';

// The email senders (web and worker) resolve the recipient through this, so a
// dropped `where` would mail someone else.
describe.concurrent('findById', () => {
    // On an empty database, a `findFirst` without its `where` returns the
    // first user inserted. Asking for the second is what makes that visible.
    it('returns the user with that id, not another one', async ({
        db,
        createUser,
    }) => {
        await createUser();
        const second = await createUser();

        const found = await createUserRepo(db).findById(second.id);

        expect(found?.id).toBe(second.id);
    });

    it('returns undefined for an unknown id', async ({ db, createUser }) => {
        // A row the query could wrongly return if it ignored the id.
        await createUser();

        const found = await createUserRepo(db).findById(crypto.randomUUID());

        expect(found).toBeUndefined();
    });
});

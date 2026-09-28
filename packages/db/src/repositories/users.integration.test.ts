import { it, expect, describe } from '../test-db/integration';
import { createUserRepo } from './users';

// The email senders (web and worker) resolve the recipient through this, so a
// dropped `where` would mail someone else. The second user makes that visible
// even on an empty database, where the first row back could be the right one
// by accident.
describe.concurrent('findById', () => {
    it('returns the user with that id, not another one', async ({
        db,
        user,
        createUser,
    }) => {
        await createUser();

        const found = await createUserRepo(db).findById(user.id);

        expect(found?.id).toBe(user.id);
    });

    it('returns undefined for an unknown id', async ({ db, createUser }) => {
        // A row the query could wrongly return if it ignored the id.
        await createUser();

        const found = await createUserRepo(db).findById(crypto.randomUUID());

        expect(found).toBeUndefined();
    });
});

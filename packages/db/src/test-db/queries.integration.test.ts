import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { it, expect, describe } from './integration';
import { insertFile, insertInvite } from './inserts';
import { deleteUsers } from './queries';

// `deleteUsers` is every integration test's teardown: if it stops removing a
// user in one go, the tier either leaks rows into the shared database or
// fails in teardown for every test that touched invites.
describe('deleteUsers', () => {
    it('removes the user with its rows, including invites it created', async ({
        db,
        createUser,
    }) => {
        const inviter = await createUser();
        const file = await insertFile(db, { userId: inviter.id });
        const invite = await insertInvite(db, { createdBy: inviter.id });

        await deleteUsers(db, [inviter.id]);

        const [user, files, invites] = await Promise.all([
            db.query.user.findFirst({
                where: eq(schema.user.id, inviter.id),
            }),
            db.query.files.findMany({ where: eq(schema.files.id, file.id) }),
            db.query.invites.findMany({
                where: eq(schema.invites.id, invite.id),
            }),
        ]);
        expect({ user, files, invites }).toEqual({
            user: undefined,
            files: [],
            invites: [],
        });
    });
});

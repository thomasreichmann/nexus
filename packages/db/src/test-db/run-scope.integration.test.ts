import { inArray } from 'drizzle-orm';
import * as schema from '../schema';
import { it, expect, describe, inRolledBackTransaction } from './integration';
import { insertUser } from './inserts';
import { deleteStaleRunScopedUsers, runScopedEmail } from './run-scope';

const DAY_MS = 86_400_000;

// The sweep runs against the shared dev DB at the start of every e2e run. If
// it matches too much it deletes a live run's users, or someone's fixed test
// user; if the naming drifts from its pattern, killed runs' users pile up.
describe('deleteStaleRunScopedUsers', () => {
    it('deletes only run-scoped users older than the cutoff', async ({
        db,
        createUser,
    }) => {
        const tag = crypto.randomUUID();
        const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
        const [
            abandoned,
            abandonedWorker,
            inFlight,
            fixedIdentity,
            notE2eDomain,
        ] = await Promise.all([
            createUser({
                email: runScopedEmail(`sweep-${tag}@test.local`, 'old1'),
                createdAt: twoDaysAgo,
            }),
            createUser({
                email: runScopedEmail(`sweep-${tag}@test.local`, 'old1', 3),
                createdAt: twoDaysAgo,
            }),
            createUser({
                email: runScopedEmail(`sweep-${tag}@test.local`, 'live'),
            }),
            createUser({
                email: `sweep-${tag}@test.local`,
                createdAt: twoDaysAgo,
            }),
            // Carries the marker, but only @test.local is ever e2e's.
            createUser({
                email: `sweep-${tag}--run-old1@example.com`,
                createdAt: twoDaysAgo,
            }),
        ]);

        await deleteStaleRunScopedUsers(db, new Date(Date.now() - DAY_MS));

        const left = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(
                inArray(
                    schema.user.id,
                    [
                        abandoned,
                        abandonedWorker,
                        inFlight,
                        fixedIdentity,
                        notE2eDomain,
                    ].map((user) => user.id)
                )
            );
        expect(left.map((row) => row.email).sort()).toEqual(
            [inFlight.email, fixedIdentity.email, notE2eDomain.email].sort()
        );
    });

    // A cutoff older than any real user, so the sweep reaches only these two,
    // and never committed, so no other run's sweep can reach them either.
    it('keeps a run-scoped user created exactly at the cutoff', ({ db }) =>
        inRolledBackTransaction(db, async (tx) => {
            const cutoff = new Date('1970-01-02T00:00:00Z');
            const tag = crypto.randomUUID();
            const [atCutoff, justBefore] = await Promise.all([
                insertUser(tx, {
                    email: runScopedEmail(`edge-${tag}@test.local`, 'at'),
                    createdAt: cutoff,
                }),
                insertUser(tx, {
                    email: runScopedEmail(`edge-${tag}@test.local`, 'before'),
                    createdAt: new Date(cutoff.getTime() - 1),
                }),
            ]);

            await deleteStaleRunScopedUsers(tx, cutoff);

            const left = await tx
                .select({ id: schema.user.id })
                .from(schema.user)
                .where(inArray(schema.user.id, [atCutoff.id, justBefore.id]));
            expect(left).toEqual([{ id: atCutoff.id }]);
        }));
});

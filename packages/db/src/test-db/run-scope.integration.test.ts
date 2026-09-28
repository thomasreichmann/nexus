import { inArray } from 'drizzle-orm';
import * as schema from '../schema';
import { it, expect, describe } from './integration';
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
});

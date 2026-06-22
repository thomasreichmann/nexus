import { test as base, expect } from './authenticated';
import type { Connection } from '@nexus/db/test-db';
import { findUserByEmail } from '@nexus/db/test-db';
import { createTestDb } from '../helpers/connection';
import { ADMIN_USER, REGULAR_USER } from '../helpers/auth';

type DbTestFixtures = {
    /** The user precondition fixtures seed against. Resolves to the shared
     *  user picked by `userRole`; `dedicated-user.ts` overrides it to a
     *  dedicated user's id when `dedicatedUserConfig` is set. */
    seedUserId: string;
};

type DbWorkerFixtures = {
    /** One typed connection per worker, disposed on worker teardown. */
    db: Connection;
};

/**
 * Adds a worker-scoped db connection and the `seedUserId` indirection to the
 * auth chain. The single back-door connection all data fixtures thread through.
 */
export const test = base.extend<DbTestFixtures, DbWorkerFixtures>({
    db: [
        async ({}, use) => {
            const db = createTestDb();
            await use(db);
            // drizzle-orm/postgres-js exposes the underlying postgres client.
            await db.$client.end({ timeout: 5 });
        },
        { scope: 'worker' },
    ],

    seedUserId: async ({ db, userRole }, use) => {
        const email =
            userRole === 'admin' ? ADMIN_USER.email : REGULAR_USER.email;
        const user = await findUserByEmail(db, email);
        if (!user) {
            throw new Error(
                `shared ${userRole} user missing (${email}) — run setup`
            );
        }
        await use(user.id);
    },
});

export { expect };

/**
 * `@nexus/db/test-db/integration` — Vitest fixtures for the real-DB
 * integration tier (`pnpm test:integration`).
 *
 * A test asks for what it needs and gets it built and torn down:
 *
 *     import { it, expect } from '@nexus/db/test-db/integration';
 *
 *     it('…', async ({ db, user }) => { … });
 *
 * - `db`: one connection pool per Vitest worker, opened on first use and
 *   closed when the worker finishes. Never build your own with `createDb`.
 * - `user`: a fresh user for this test. Everything it owns is deleted with it
 *   afterwards, in one statement (`deleteUsers`).
 * - `createUser`: more users for this test (a second owner for an ownership
 *   test), torn down with `user` in that same statement.
 * - `fileUser`: one user shared by every test in the file, for suites where a
 *   user per test would cost more round trips than its isolation is worth.
 *   Its rows accumulate across the file's tests and go at the end.
 *
 * Rows that no user owns (`background_jobs`, `verification`) don't cascade:
 * a test that creates them deletes them itself.
 *
 * Kept out of `@nexus/db/test-db`'s index on purpose: that entrypoint is
 * vitest-free so Playwright can load it, and this module imports `vitest`.
 */
import { test } from 'vitest';
import { createDb, type Connection } from '../connection';
import { insertUser } from './inserts';
import { deleteUsers } from './queries';
import type { User } from '../repositories/fixtures';

export interface IntegrationFixtures {
    db: Connection;
    createUser: (overrides?: Partial<User>) => Promise<User>;
    user: User;
    fileUser: User;
}

export const it = test.extend<IntegrationFixtures>({
    db: [
        // eslint-disable-next-line no-empty-pattern -- Vitest reads fixture dependencies from the destructuring pattern, so it must be present even when empty
        async ({}, use) => {
            const url = process.env.DATABASE_URL;
            if (!url) {
                throw new Error(
                    'DATABASE_URL is not set: the integration tier needs a real Postgres. Locally it comes from apps/web/.env.local; `pnpm test:integration:fresh` runs against a throwaway one.'
                );
            }
            const db = createDb(url);
            await use(db);
            await db.$client.end();
        },
        { scope: 'worker' },
    ],

    createUser: async ({ db }, use) => {
        const ids: string[] = [];
        await use(async (overrides) => {
            const user = await insertUser(db, overrides);
            ids.push(user.id);
            return user;
        });
        await deleteUsers(db, ids);
    },

    user: async ({ createUser }, use) => {
        await use(await createUser());
    },

    fileUser: [
        async ({ db }, use) => {
            const user = await insertUser(db);
            await use(user);
            await deleteUsers(db, [user.id]);
        },
        { scope: 'file' },
    ],
});

// `vi` is deliberately not re-exported: `vi.mock` is only hoisted above the
// imports when `vi` comes from 'vitest' itself.
export { describe, expect, beforeEach, afterEach } from 'vitest';

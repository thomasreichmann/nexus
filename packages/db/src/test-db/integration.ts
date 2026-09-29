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
 * - `createJob`: a `background_jobs` row, deleted after the test. Jobs have
 *   no user to cascade from, and a leftover one shows up in the admin jobs
 *   table and crowds out e2e's seeded rows (#419).
 * - `createWebhookEvent`: inserts a `webhook_events` row (`insertWebhookEvent`)
 *   and deletes it after the test. Those rows belong to no user either, so
 *   `user`'s teardown never reaches them.
 *
 * There is no file-scoped user: Vitest 4 runs a file-scoped fixture against
 * the file's context, where the worker-scoped `db` never lands, so it would
 * receive `db` as undefined. `fileUser` shipped that way unused and was
 * removed on first use (#501).
 *
 * Other rows that no user owns (`verification`) don't cascade either: a test
 * that creates them deletes them itself.
 *
 * `inRolledBackTransaction` is for a test whose query scans the whole table
 * and whose rows another run of the same test would also seed (below).
 *
 * Kept out of `@nexus/db/test-db`'s index on purpose: that entrypoint is
 * vitest-free so Playwright can load it, and this module imports `vitest`.
 */
import { TransactionRollbackError } from 'drizzle-orm';
import { test } from 'vitest';
import { createDb, type Connection, type Transaction } from '../connection';
import { createNewJobFixture, type User } from '../repositories/fixtures';
import { createJobRepo, type Job, type NewJob } from '../repositories/jobs';
import { insertUser, insertWebhookEvent } from './inserts';
import { deleteJob, deleteUsers, deleteWebhookEvents } from './queries';
import type { WebhookEvent } from '../repositories/webhooks';

export interface IntegrationFixtures {
    db: Connection;
    createUser: (overrides?: Partial<User>) => Promise<User>;
    user: User;
    createJob: (overrides?: Partial<NewJob>) => Promise<Job>;
    createWebhookEvent: (
        overrides?: Partial<WebhookEvent>
    ) => Promise<WebhookEvent>;
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

    createJob: async ({ db }, use) => {
        const ids: string[] = [];
        await use(async (overrides) => {
            const job = await createJobRepo(db).insert(
                createNewJobFixture(overrides)
            );
            ids.push(job.id);
            return job;
        });
        await Promise.all(ids.map((id) => deleteJob(db, id)));
    },

    createWebhookEvent: async ({ db }, use) => {
        const ids: string[] = [];
        await use(async (overrides) => {
            const event = await insertWebhookEvent(db, overrides);
            ids.push(event.id);
            return event;
        });
        await deleteWebhookEvents(db, ids);
    },
});

/**
 * Runs `fn` (arrange, act and assert) in a transaction that is always rolled
 * back. Its rows are never committed, so no other connection ever sees them.
 *
 * Use it when the query scans the whole table (newest first, say) and the
 * test's rows can't be told apart from another run's: `pnpm mutate`'s
 * workers share one database, and so do engineers on dev. Two runs seeding
 * the same far-future dates would each read the other's rows (#524). A
 * failing assertion inside `fn` rolls back too, and fails the test as usual.
 */
export async function inRolledBackTransaction(
    db: Connection,
    fn: (tx: Transaction) => Promise<void>
): Promise<void> {
    try {
        await db.transaction(async (tx) => {
            await fn(tx);
            tx.rollback();
        });
    } catch (error) {
        if (!(error instanceof TransactionRollbackError)) throw error;
    }
}

// `vi` is deliberately not re-exported: `vi.mock` is only hoisted above the
// imports when `vi` comes from 'vitest' itself.
export { describe, expect, beforeEach, afterEach } from 'vitest';

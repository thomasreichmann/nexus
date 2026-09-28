import { basename } from 'node:path';
import { deleteUserByEmail, runScopedEmail } from '@nexus/db/test-db';
import { test as base, expect } from './db';
import { type TestUser, provisionDedicatedUser } from '../helpers/auth';
import { E2E_RUN_ID, runStatePath } from '../helpers/run-id';

type DedicatedUserWorkerFixtures = {
    /**
     * Opts a spec into a dedicated per-spec user. Set at file top level via
     * `test.use(...)` — NEVER inside a describe (Playwright errors: a
     * worker-scoped option set in a describe would force a new worker).
     * Use a unique email + state path per spec so worker teardown can't delete
     * a user another spec reuses. Both are base names: the fixture scopes them
     * to this run and worker.
     */
    dedicatedUserConfig: { user: TestUser; statePath: string } | null;
    /** Provisioned once per worker; null when no config is set. */
    dedicatedUser: { userId: string; statePath: string } | null;
};

/**
 * Folds dedicated-user provisioning into the fixture chain. A worker-scoped
 * `dedicatedUser` fixture creates the user + trial sub + signed-in state file
 * once, and deletes the user on worker teardown. The test-scoped `storageState`
 * and `seedUserId` overrides point at the dedicated user when one is configured,
 * and fall through to the shared-user behavior otherwise — so the same
 * precondition fixtures serve both flows (dedicated) and smoke/admin (shared).
 */
export const test = base.extend<
    NonNullable<unknown>,
    DedicatedUserWorkerFixtures
>({
    dedicatedUserConfig: [null, { option: true, scope: 'worker' }],

    dedicatedUser: [
        async ({ db, dedicatedUserConfig }, use, workerInfo) => {
            if (!dedicatedUserConfig) {
                await use(null);
                return;
            }
            // The configured email and path are a base name. The user is
            // this worker's own (#484): another run, or another worker of
            // this run picking up the same file, gets a different one, so
            // neither can reset its data or delete it mid-test.
            const { workerIndex } = workerInfo;
            const user = {
                ...dedicatedUserConfig.user,
                email: runScopedEmail(
                    dedicatedUserConfig.user.email,
                    E2E_RUN_ID,
                    workerIndex
                ),
            };
            const statePath = runStatePath(
                `${basename(dedicatedUserConfig.statePath, '.json')}-w${workerIndex}`
            );
            const { userId } = await provisionDedicatedUser(
                db,
                user,
                statePath
            );
            await use({ userId, statePath });
            // Teardown: remove the dedicated user (cascades all its data).
            await deleteUserByEmail(db, user.email);
        },
        { scope: 'worker' },
    ],

    // Test-scoped override. storageState sits in the browser context's
    // dependency graph, so Playwright resolves this (awaiting dedicatedUser,
    // which writes the state file) before building the context.
    storageState: async ({ dedicatedUser, storageState }, use) => {
        await use(dedicatedUser ? dedicatedUser.statePath : storageState);
    },

    // Redirect precondition fixtures to seed for the dedicated user when set.
    seedUserId: async ({ dedicatedUser, seedUserId }, use) => {
        await use(dedicatedUser ? dedicatedUser.userId : seedUserId);
    },
});

export { expect };

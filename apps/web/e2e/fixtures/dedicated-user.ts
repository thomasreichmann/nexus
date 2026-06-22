import { test as base, expect } from './db';
import { type TestUser, provisionDedicatedUser } from '../helpers/auth';
import { deleteUserByEmail } from '@nexus/db/test-db';

type DedicatedUserWorkerFixtures = {
    /**
     * Opts a spec into a dedicated per-spec user. Set at file top level via
     * `test.use(...)` — NEVER inside a describe (Playwright errors: a
     * worker-scoped option set in a describe would force a new worker).
     * Use a unique email + state path per spec so worker teardown can't delete
     * a user another spec reuses.
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
    Record<string, never>,
    DedicatedUserWorkerFixtures
>({
    dedicatedUserConfig: [null, { option: true, scope: 'worker' }],

    dedicatedUser: [
        async ({ db, dedicatedUserConfig }, use) => {
            if (!dedicatedUserConfig) {
                await use(null);
                return;
            }
            const { user, statePath } = dedicatedUserConfig;
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

import { test as setup } from '@playwright/test';
import {
    findUserByEmail,
    ensureTrialSubscription,
    deleteUserData,
} from '@nexus/db/test-db';
import {
    ADMIN_USER,
    ADMIN_STATE_PATH,
    REGULAR_USER,
    USER_STATE_PATH,
    createUser,
    promoteToAdmin,
    authenticateAndSaveState,
} from './helpers/auth';
import { createTestDb } from './helpers/connection';

/**
 * Clear the shared users' domain data at the start of a run, so leftovers from
 * the previous run can't produce strict-mode violations ("resolved to 3
 * elements") in specs that assert on a filename.
 *
 * Only when this worktree has its own database — E2E_DATABASE_URL, loaded by
 * playwright.config.ts from the git-ignored .env.e2e.local that
 * .claude/hooks/worktree-setup.sh writes. On the shared dev DB a wipe would
 * delete rows out from under another worktree's in-flight run — the exact
 * failure this whole change exists to remove.
 */
const OWNS_DB = !!process.env.E2E_DATABASE_URL;

// The setup project runs outside the fixture chain, so it owns its own
// connection (created + disposed per setup test) rather than the worker `db`
// fixture.

setup('create and authenticate admin user', async ({ request }) => {
    const db = createTestDb();
    try {
        await createUser(request, db, ADMIN_USER);
        await promoteToAdmin(db, ADMIN_USER.email);
        const user = await findUserByEmail(db, ADMIN_USER.email);
        if (!user) {
            throw new Error(
                `admin user not found after createUser: ${ADMIN_USER.email}`
            );
        }
        if (OWNS_DB) await deleteUserData(db, user.id);
        await ensureTrialSubscription(db, user.id);
        await authenticateAndSaveState(request, ADMIN_USER, ADMIN_STATE_PATH);
    } finally {
        await db.$client.end({ timeout: 5 });
    }
});

setup('create and authenticate regular user', async ({ request }) => {
    const db = createTestDb();
    try {
        await createUser(request, db, REGULAR_USER);
        const user = await findUserByEmail(db, REGULAR_USER.email);
        if (!user) {
            throw new Error(
                `regular user not found after createUser: ${REGULAR_USER.email}`
            );
        }
        if (OWNS_DB) await deleteUserData(db, user.id);
        await ensureTrialSubscription(db, user.id);
        await authenticateAndSaveState(request, REGULAR_USER, USER_STATE_PATH);
    } finally {
        await db.$client.end({ timeout: 5 });
    }
});

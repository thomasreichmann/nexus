import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test as setup } from '@playwright/test';
import {
    findUserByEmail,
    ensureTrialSubscription,
    deleteStaleRunScopedUsers,
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
import { createTestDb, withTestDb } from './helpers/connection';

// The users signed up here are this run's own (`helpers/run-id.ts`), so they
// start empty and no other run can touch them; `global.teardown.ts` deletes
// them. The setup project runs outside the fixture chain, so it owns its own
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
        await ensureTrialSubscription(db, user.id);
        await authenticateAndSaveState(request, REGULAR_USER, USER_STATE_PATH);
    } finally {
        await db.$client.end({ timeout: 5 });
    }
});

/**
 * A killed run never reaches its teardown, so its users and state files stay
 * behind. A day is far longer than any run, so nothing swept here is in use.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const AUTH_DIR = 'e2e/.auth';

setup('sweep users and auth state left by killed runs', async () => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    await withTestDb((db) => deleteStaleRunScopedUsers(db, new Date(cutoff)));
    if (!existsSync(AUTH_DIR)) return;
    for (const entry of readdirSync(AUTH_DIR)) {
        const dir = join(AUTH_DIR, entry);
        if (entry.startsWith('run-') && statSync(dir).mtimeMs < cutoff) {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

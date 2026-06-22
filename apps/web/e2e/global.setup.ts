import { test as setup } from '@playwright/test';
import {
    ADMIN_USER,
    ADMIN_STATE_PATH,
    REGULAR_USER,
    USER_STATE_PATH,
    createUser,
    promoteToAdmin,
    authenticateAndSaveState,
} from './helpers/auth';
import { findUserByEmail, ensureTrialSubscription } from '@nexus/db/test-db';
import { createTestDb } from './helpers/connection';

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

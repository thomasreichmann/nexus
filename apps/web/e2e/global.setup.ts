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
import { ensureTrialSubscription, findUserByEmail } from './helpers/db';

setup('create and authenticate admin user', async ({ request }) => {
    await createUser(request, ADMIN_USER);
    await promoteToAdmin(ADMIN_USER.email);
    const user = await findUserByEmail(ADMIN_USER.email);
    if (!user)
        throw new Error(
            `admin user not found after createUser: ${ADMIN_USER.email}`
        );
    await ensureTrialSubscription(user.id);
    await authenticateAndSaveState(request, ADMIN_USER, ADMIN_STATE_PATH);
});

setup('create and authenticate regular user', async ({ request }) => {
    await createUser(request, REGULAR_USER);
    const user = await findUserByEmail(REGULAR_USER.email);
    if (!user)
        throw new Error(
            `regular user not found after createUser: ${REGULAR_USER.email}`
        );
    await ensureTrialSubscription(user.id);
    await authenticateAndSaveState(request, REGULAR_USER, USER_STATE_PATH);
});

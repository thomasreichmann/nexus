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

setup('create and authenticate admin user', async ({ request }) => {
    await createUser(request, ADMIN_USER);
    await promoteToAdmin(ADMIN_USER.email);
    await authenticateAndSaveState(request, ADMIN_USER, ADMIN_STATE_PATH);
});

setup('create and authenticate regular user', async ({ request }) => {
    await createUser(request, REGULAR_USER);
    await authenticateAndSaveState(request, REGULAR_USER, USER_STATE_PATH);
});

import { test as base, expect } from './console';
import { ADMIN_STATE_PATH, USER_STATE_PATH } from '../helpers/auth';

type UserRole = 'admin' | 'user';

/**
 * Extends the console-tracking test with auth storageState selected by role.
 * See docs/conventions/testing.md for full usage patterns.
 */
export const test = base.extend<{ userRole: UserRole }>({
    userRole: ['user', { option: true }],

    storageState: async ({ userRole }, use) => {
        await use(userRole === 'admin' ? ADMIN_STATE_PATH : USER_STATE_PATH);
    },
});

export { expect };

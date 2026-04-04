import { test as base, expect } from '@playwright/test';
import { ADMIN_STATE_PATH, USER_STATE_PATH } from '../helpers/auth';
import { setupConsoleErrorTracking } from '../utils';

type UserRole = 'admin' | 'user';

interface AuthenticatedFixtures {
    userRole: UserRole;
    consoleErrors: string[];
}

/**
 * Extends base Playwright test with auth storageState and console error tracking.
 * See docs/conventions/testing.md for full usage patterns.
 */
export const test = base.extend<AuthenticatedFixtures>({
    userRole: ['user', { option: true }],

    storageState: async ({ userRole }, use) => {
        await use(userRole === 'admin' ? ADMIN_STATE_PATH : USER_STATE_PATH);
    },

    consoleErrors: async ({ page }, use) => {
        const errors = setupConsoleErrorTracking(page);
        await use(errors);
    },
});

export { expect };

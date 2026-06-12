import { test as base, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

/**
 * Base test with console error tracking. Specs that manage their own auth
 * (e.g. flows specs with dedicated users) extend from here instead of
 * `authenticated` so they don't lose hydration-error detection.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
    consoleErrors: async ({ page }, use) => {
        await use(setupConsoleErrorTracking(page));
    },
});

export { expect };

import type { Page, ConsoleMessage } from '@playwright/test';

/**
 * Tracks console errors during page interactions.
 * Call before navigating, then assert `errors` is empty after render.
 */
export function setupConsoleErrorTracking(page: Page): string[] {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });
    return errors;
}

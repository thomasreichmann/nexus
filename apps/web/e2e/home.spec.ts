import { test, expect, type ConsoleMessage } from '@playwright/test';

// Helper to collect console errors during page load
function setupConsoleErrorTracking(page: import('@playwright/test').Page) {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });
    return errors;
}

test.describe('Landing Page', () => {
    test('renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/');

        // Verify key sections are present
        await expect(page.getByRole('banner')).toBeVisible(); // Header
        await expect(page.getByRole('main')).toBeVisible();
        await expect(page.getByRole('contentinfo')).toBeVisible(); // Footer

        // Check for console errors after render
        expect(errors).toEqual([]);
    });
});

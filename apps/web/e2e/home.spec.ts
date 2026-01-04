import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from './utils';

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

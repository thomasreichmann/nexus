import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test.describe('Dev Preview Page', () => {
    test('renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/dev/preview');

        await expect(page.getByRole('heading')).toBeVisible();

        expect(errors).toEqual([]);
    });
});

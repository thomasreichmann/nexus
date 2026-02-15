import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test('admin jobs page renders without console errors', async ({ page }) => {
    const errors = setupConsoleErrorTracking(page);

    await page.goto('/dashboard/admin/jobs');

    await expect(
        page.getByRole('heading', { name: /background jobs/i })
    ).toBeVisible();

    expect(errors).toEqual([]);
});

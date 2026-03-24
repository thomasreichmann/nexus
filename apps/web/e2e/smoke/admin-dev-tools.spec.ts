import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test('admin dev tools page renders without console errors', async ({
    page,
}) => {
    const errors = setupConsoleErrorTracking(page);

    await page.goto('/dashboard/admin/dev-tools');

    await expect(
        page.getByRole('heading', { name: /dev-tools/i })
    ).toBeVisible();

    expect(errors).toEqual([]);
});

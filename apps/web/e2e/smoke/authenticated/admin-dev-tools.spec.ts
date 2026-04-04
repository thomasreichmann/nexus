import { test, expect } from '../../fixtures/authenticated';

test.use({ userRole: 'admin' });

test.describe('Admin Dev Tools', () => {
    test('admin dev tools page renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/admin/dev-tools');

        await expect(
            page.getByRole('heading', { name: /dev-tools/i })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });
});

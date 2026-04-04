import { test, expect } from '../../fixtures/authenticated';

test.use({ userRole: 'admin' });

test.describe('Admin Jobs', () => {
    test('admin jobs page renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/admin/jobs');

        await expect(
            page.getByRole('heading', { name: /background jobs/i })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });
});

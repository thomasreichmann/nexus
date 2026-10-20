import { test, expect } from '../../fixtures/authenticated';

test.use({ userRole: 'admin' });

test.describe('Admin Partial batches', () => {
    test(
        'admin partial batches page renders without console errors',
        { tag: ['@page:/dashboard/admin/batches'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/admin/batches');

            await expect(
                page.getByRole('heading', { name: 'Partial batches' })
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );
});

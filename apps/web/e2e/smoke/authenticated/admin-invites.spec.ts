import { test, expect } from '../../fixtures/authenticated';

test.use({ userRole: 'admin' });

test.describe('Admin Invites', () => {
    test(
        'admin invites page renders without console errors',
        { tag: ['@page:/dashboard/admin/invites'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/admin/invites');

            await expect(
                page.getByRole('heading', { name: /invites/i })
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );
});

import { test, expect } from '../../fixtures/authenticated';

test.use({ userRole: 'user' });

test.describe('Dashboard Pages', () => {
    test(
        'dashboard overview renders without console errors',
        { tag: ['@page:/dashboard', '@uc:dashboard-widgets-render'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard');

            // Heading includes user name only when authenticated
            await expect(
                page.getByRole('heading', { name: /welcome back, .+/i })
            ).toBeVisible();
            await expect(page.getByText('Storage Usage')).toBeVisible();
            await expect(page.getByText('Storage by Type')).toBeVisible();
            await expect(page.getByText('Upload History')).toBeVisible();
            await expect(page.getByText('Recent Uploads')).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );

    test(
        'files page renders without console errors',
        { tag: ['@page:/dashboard/files'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/files');

            await expect(
                page.getByRole('heading', { name: /files/i })
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );

    test(
        'upload page renders without console errors',
        { tag: ['@page:/dashboard/upload'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/upload');

            await expect(
                page.getByRole('heading', { name: 'Upload Files', exact: true })
            ).toBeVisible();
            await expect(
                page.getByText('Drop files here to upload')
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );

    test(
        'settings page renders without console errors',
        { tag: ['@page:/dashboard/settings', '@uc:settings-sections-render'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/settings');

            await expect(
                page.getByRole('heading', { name: /settings/i })
            ).toBeVisible();

            // All four sections render: profile, subscription, password,
            // danger. CardTitle renders a div, not a heading — match by text.
            await expect(
                page.getByText('Profile', { exact: true })
            ).toBeVisible();
            await expect(
                page.getByText('Password', { exact: true })
            ).toBeVisible();
            await expect(
                page.getByText('Danger Zone', { exact: true })
            ).toBeVisible();

            // Subscription section renders once tRPC resolves; seeded users get a
            // starter trial row so all three checkout tiers should be visible.
            // The card header renders before the query resolves, so the first
            // heading gates on subscriptions.current — give it the suite's 15s
            // cold-start allowance (see auth-flows/invite specs).
            await expect(
                page.getByText('Manage your storage plan')
            ).toBeVisible();
            await expect(
                page.getByRole('heading', { name: 'Starter', exact: true })
            ).toBeVisible({ timeout: 15_000 });
            await expect(
                page.getByRole('heading', { name: 'Pro', exact: true })
            ).toBeVisible();
            await expect(
                page.getByRole('heading', { name: 'Max', exact: true })
            ).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );
});

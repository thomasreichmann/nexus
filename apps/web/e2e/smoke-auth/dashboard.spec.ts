import { test, expect } from '../fixtures/authenticated';

test.use({ userRole: 'user' });

test.describe('Dashboard Pages', () => {
    test('dashboard overview renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard');

        await expect(
            page.getByRole('heading', { name: /welcome back/i })
        ).toBeVisible();
        await expect(page.getByText('Storage Usage')).toBeVisible();
        await expect(page.getByText('Storage by Type')).toBeVisible();
        await expect(page.getByText('Upload History')).toBeVisible();
        await expect(page.getByText('Recent Uploads')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });

    test('files page renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/files');

        await expect(
            page.getByRole('heading', { name: /files/i })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });

    test('upload page renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/upload');

        await expect(
            page.getByRole('heading', { name: 'Upload Files', exact: true })
        ).toBeVisible();
        await expect(page.getByText('Drop files here to upload')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });

    test('settings page renders without console errors', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/settings');

        await expect(
            page.getByRole('heading', { name: /settings/i })
        ).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });
});

import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test.describe('Dashboard Pages', () => {
    test('dashboard overview renders without console errors', async ({
        page,
    }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/dashboard');

        // Verify key elements are present
        await expect(
            page.getByRole('heading', { name: 'Dashboard', exact: true })
        ).toBeVisible();
        await expect(page.getByText('Recent Uploads')).toBeVisible();

        expect(errors).toEqual([]);
    });

    test('files page renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/dashboard/files');

        // Verify file browser elements are present
        await expect(
            page.getByRole('heading', { name: /files/i })
        ).toBeVisible();
        await expect(page.getByPlaceholder(/search/i)).toBeVisible();

        expect(errors).toEqual([]);
    });

    test('upload page renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/dashboard/upload');

        // Verify upload zone elements are present
        await expect(
            page.getByRole('heading', { name: 'Upload Files', exact: true })
        ).toBeVisible();
        await expect(page.getByText('Drop files here to upload')).toBeVisible();

        expect(errors).toEqual([]);
    });

    test('settings page renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/dashboard/settings');

        // Verify settings page elements are present
        await expect(
            page.getByRole('heading', { name: /settings/i })
        ).toBeVisible();

        expect(errors).toEqual([]);
    });
});

import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test.describe('Auth Pages', () => {
    test('sign-in page renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/sign-in');

        // Verify form elements are present
        await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
        await expect(page.getByLabel(/password/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

        expect(errors).toEqual([]);
    });

    test('sign-up page renders without console errors', async ({ page }) => {
        const errors = setupConsoleErrorTracking(page);

        await page.goto('/sign-up');

        // Verify form elements are present
        await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
        await expect(page.getByLabel(/email/i)).toBeVisible();
        await expect(page.getByLabel(/password/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();

        expect(errors).toEqual([]);
    });
});

import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test.describe('Auth Pages', () => {
    test(
        'sign-in page renders without console errors',
        { tag: ['@page:/sign-in'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/sign-in');

            // Verify form elements are present
            await expect(
                page.getByRole('heading', { name: /welcome back/i })
            ).toBeVisible();
            await expect(page.getByLabel(/email/i)).toBeVisible();
            await expect(page.getByLabel(/password/i)).toBeVisible();
            await expect(
                page.getByRole('button', { name: /sign in/i })
            ).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'sign-up page renders without console errors',
        { tag: ['@page:/sign-up'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/sign-up');

            // Verify form elements are present
            await expect(
                page.getByRole('heading', { name: /create your account/i })
            ).toBeVisible();
            await expect(page.getByLabel(/email/i)).toBeVisible();
            await expect(page.getByLabel(/password/i)).toBeVisible();
            await expect(
                page.getByRole('button', { name: /create account/i })
            ).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'invite page shows a friendly message for an invalid token',
        { tag: ['@page:/invite/[token]'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/invite/definitely-not-a-real-token');

            await expect(
                page.getByRole('heading', { name: /invite unavailable/i })
            ).toBeVisible();
            // Never render the signup form for an unusable invite.
            await expect(
                page.getByRole('button', { name: /create account/i })
            ).toHaveCount(0);

            expect(errors).toEqual([]);
        }
    );
});

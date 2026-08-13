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
        'forgot-password page renders without console errors',
        { tag: ['@page:/forgot-password'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/forgot-password');

            await expect(
                page.getByRole('heading', { name: /forgot your password/i })
            ).toBeVisible();
            await expect(page.getByLabel(/email/i)).toBeVisible();
            await expect(
                page.getByRole('button', { name: /send reset link/i })
            ).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'reset-password page renders the form for a token-bearing link',
        { tag: ['@page:/reset-password'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            // Validity is only checked on submit, so any token renders the form.
            await page.goto('/reset-password?token=render-check');

            await expect(
                page.getByRole('heading', { name: /choose a new password/i })
            ).toBeVisible();
            await expect(page.getByLabel(/new password/i)).toBeVisible();
            await expect(
                page.getByRole('button', { name: /set new password/i })
            ).toBeVisible();

            expect(errors).toEqual([]);
        }
    );
});

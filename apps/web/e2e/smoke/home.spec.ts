import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test.describe('Landing Page', () => {
    test(
        'renders without console errors',
        { tag: ['@page:/'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/');

            // Verify key sections are present
            await expect(page.getByRole('banner')).toBeVisible(); // Header
            await expect(page.getByRole('main')).toBeVisible();
            await expect(page.getByRole('contentinfo')).toBeVisible(); // Footer

            // Check for console errors after render
            expect(errors).toEqual([]);
        }
    );

    test(
        'hero CTA navigates to sign-up',
        { tag: ['@page:/', '@uc:landing-cta-signup'] },
        async ({ page }) => {
            await page.goto('/');

            await page
                .getByRole('button', { name: 'Start storing free' })
                .first()
                .click();

            await expect(page).toHaveURL(/\/sign-up/);
            await expect(
                page.getByRole('heading', { name: /create your account/i })
            ).toBeVisible();
        }
    );
});

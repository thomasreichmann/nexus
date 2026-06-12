/**
 * Render smoke tests for the dev-only pages (/design, /dev/studio,
 * /dev/coverage). Public, no auth required.
 */
import { test, expect } from '@playwright/test';
import { setupConsoleErrorTracking } from '../utils';

test.describe('Dev Pages', () => {
    test(
        'design system page renders without console errors',
        { tag: ['@page:/design'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/design');

            await expect(page.getByRole('heading').first()).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'tRPC studio page renders without console errors',
        { tag: ['@page:/dev/studio'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/dev/studio');

            await expect(page.getByRole('heading').first()).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'coverage report page renders with sections and live verdict',
        { tag: ['@page:/dev/report'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/dev/report');

            await expect(
                page.getByRole('heading', {
                    name: /E2E Coverage: from untracked/,
                })
            ).toBeVisible();
            // Live strip resolves from the coverage API (report generated →
            // numbers; missing → regeneration hint). Either way no spinner.
            await expect(
                page.getByText('Fetching /api/dev/coverage…')
            ).toBeHidden({ timeout: 15_000 });
            await expect(page.getByText('The path')).toBeVisible();
            await expect(page.getByText('Findings')).toBeVisible();
            await expect(page.getByText('Performance')).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'coverage dashboard renders unit + E2E sections without console errors',
        { tag: ['@page:/dev/coverage'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto('/dev/coverage');

            await expect(
                page.getByRole('heading', { name: 'Test Coverage' })
            ).toBeVisible();
            // Both section headers render regardless of whether report data
            // exists (each falls back to a "No data yet" hint).
            await expect(page.getByText('E2E · Playwright')).toBeVisible();
            await expect(page.getByText('Unit · Vitest')).toBeVisible();

            expect(errors).toEqual([]);
        }
    );
});

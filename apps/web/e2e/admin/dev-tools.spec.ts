/**
 * Admin dev-tools interactions: seed summary, running a scenario, cleaning
 * seed data, and the TrialExpiredError → banner wiring. Seeding targets the
 * admin user ("me") and the cleanup mutation removes only seed-flagged data,
 * so directly-inserted rows from other admin-project specs are untouched.
 */
import { test, expect } from '@playwright/test';

const PAGE_URL = '/dashboard/admin/dev-tools';

// Seed → cleanup share state on the admin user; keep ordered.
test.describe.configure({ mode: 'serial' });

test.describe('admin dev-tools', () => {
    test(
        'seed summary stat cards render',
        {
            tag: [
                '@page:/dashboard/admin/dev-tools',
                '@uc:devtools-summary-cards',
            ],
        },
        async ({ page }) => {
            await page.goto(PAGE_URL);

            // Stat-card labels are spans; "Retrievals"/"Storage" also appear
            // in scenario rows and the custom-seed form, so scope to spans.
            for (const label of [
                'Seed Files',
                'Retrievals',
                'Seed Users',
                'Storage',
            ]) {
                await expect(
                    page
                        .locator('span')
                        .filter({ hasText: new RegExp(`^${label}$`) })
                        .first()
                ).toBeVisible();
            }
        }
    );

    test(
        'running a scenario seeds files and cleanup removes them',
        { tag: ['@uc:devtools-run-scenario', '@uc:devtools-seed-and-cleanup'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);

            // Light User: 5 files, no retrievals — the cheapest preset.
            await page
                .getByRole('button', { name: 'Run Light User scenario' })
                .click();

            await expect(page.getByRole('status')).toContainText(
                'seeded +5 files',
                { timeout: 30_000 }
            );

            // Clean up the seed data for the current (admin) user.
            await page.getByRole('button', { name: 'Clean me' }).click();
            await page
                .getByRole('button', { name: 'Clean', exact: true })
                .click();

            await expect(page.getByText('Cleanup complete.')).toBeVisible({
                timeout: 30_000,
            });
        }
    );

    test(
        'TrialExpiredError surfaces the trial-expired banner',
        { tag: ['@uc:trial-expired-banner'] },
        async ({ page }) => {
            await page.goto(PAGE_URL);

            await page
                .getByRole('button', { name: 'Throw TrialExpiredError' })
                .click();

            // Filter by text — Next.js's route announcer is also role=alert.
            const banner = page
                .getByRole('alert')
                .filter({ hasText: 'Your trial has expired' });
            await expect(banner).toBeVisible({ timeout: 10_000 });
        }
    );
});

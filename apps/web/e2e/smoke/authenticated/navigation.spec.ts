/**
 * Dashboard chrome: sidebar navigation, role-based nav visibility, and the
 * sidebar storage widget. Read-only — safe to run in parallel with other
 * smoke specs sharing the regular user.
 */
import { test, expect } from '../../fixtures/authenticated';
import { REGULAR_USER } from '../../helpers/auth';
import type { Page } from '@playwright/test';

test.use({ userRole: 'user' });

/**
 * Opens the dashboard once the browser's own session fetch has answered. The
 * sidebar's admin links come from that fetch (`useSession`), not from the
 * server render, so until it lands every user sees the regular list. A failed
 * fetch fails here, with its status, rather than as a missing link (#544).
 */
async function openDashboard(page: Page) {
    const session = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/auth/get-session'
    );
    await page.goto('/dashboard');
    expect((await session).status()).toBe(200);
}

test.describe('dashboard navigation', () => {
    test(
        'sidebar links navigate between dashboard pages',
        { tag: ['@page:/dashboard', '@uc:sidebar-navigation'] },
        async ({ page }) => {
            await page.goto('/dashboard');
            const sidebar = page.getByRole('complementary');

            await sidebar.getByRole('link', { name: 'Files' }).click();
            await expect(page).toHaveURL(/\/dashboard\/files/);
            await expect(
                page.getByRole('heading', { name: /files/i })
            ).toBeVisible();

            await sidebar.getByRole('link', { name: 'Upload' }).click();
            await expect(page).toHaveURL(/\/dashboard\/upload/);
            await expect(
                page.getByRole('heading', { name: 'Upload Files', exact: true })
            ).toBeVisible();

            await sidebar.getByRole('link', { name: 'Settings' }).click();
            await expect(page).toHaveURL(/\/dashboard\/settings/);
            await expect(
                page.getByRole('heading', { name: /settings/i })
            ).toBeVisible();

            await sidebar.getByRole('link', { name: 'Dashboard' }).click();
            await expect(page).toHaveURL(/\/dashboard$/);
        }
    );

    test(
        'admin nav items are hidden from regular users',
        { tag: ['@uc:sidebar-admin-visibility'] },
        async ({ page }) => {
            await openDashboard(page);
            const sidebar = page.getByRole('complementary');

            // The account menu shows who's signed in only once the session
            // has rendered, the same render that would add admin links: the
            // response landing isn't that render yet.
            await page.getByRole('button', { name: 'User menu' }).click();
            await expect(page.getByText(REGULAR_USER.email)).toBeVisible();
            await page.keyboard.press('Escape');

            await expect(
                sidebar.getByRole('link', { name: 'Files' })
            ).toBeVisible();
            await expect(
                sidebar.getByRole('link', { name: 'Jobs' })
            ).toHaveCount(0);
            await expect(
                sidebar.getByRole('link', { name: 'Dev Tools' })
            ).toHaveCount(0);
        }
    );

    test.describe('as an admin', () => {
        // The test's own page rather than a second context, so a failure's
        // snapshot is of the admin's dashboard (#544).
        test.use({ userRole: 'admin' });

        test(
            'admin nav items are shown to admins',
            { tag: ['@uc:sidebar-admin-visibility'] },
            async ({ page }) => {
                await openDashboard(page);
                const sidebar = page.getByRole('complementary');

                await expect(
                    sidebar.getByRole('link', { name: 'Jobs' })
                ).toBeVisible();
                await expect(
                    sidebar.getByRole('link', { name: 'Dev Tools' })
                ).toBeVisible();
            }
        );
    });

    test(
        'sidebar storage widget shows usage against quota',
        { tag: ['@uc:sidebar-storage-widget'] },
        async ({ page }) => {
            await page.goto('/dashboard');

            const sidebar = page.getByRole('complementary');
            await expect(sidebar.getByText('Storage used')).toBeVisible();
            // Resolves from "Loading..." to "<used> of <quota>".
            await expect(sidebar.getByText(/ of /)).toBeVisible({
                timeout: 15_000,
            });
        }
    );
});

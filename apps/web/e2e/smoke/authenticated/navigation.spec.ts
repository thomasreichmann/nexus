/**
 * Dashboard chrome: sidebar navigation, role-based nav visibility, and the
 * sidebar storage widget. Read-only — safe to run in parallel with other
 * smoke specs sharing the regular user.
 */
import { test, expect } from '../../fixtures/authenticated';
import { ADMIN_STATE_PATH } from '../../helpers/auth';

test.use({ userRole: 'user' });

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
        'admin nav items are hidden from regular users and shown to admins',
        { tag: ['@uc:sidebar-admin-visibility'] },
        async ({ page, browser }) => {
            await page.goto('/dashboard');
            const sidebar = page.getByRole('complementary');

            // Regular user: core links render, admin links don't. Wait for
            // the session-dependent nav to settle on a core link first.
            await expect(
                sidebar.getByRole('link', { name: 'Files' })
            ).toBeVisible();
            await expect(
                sidebar.getByRole('link', { name: 'Jobs' })
            ).toHaveCount(0);
            await expect(
                sidebar.getByRole('link', { name: 'Dev Tools' })
            ).toHaveCount(0);

            // Admin sees both admin entries.
            const adminContext = await browser.newContext({
                storageState: ADMIN_STATE_PATH,
            });
            const adminPage = await adminContext.newPage();
            await adminPage.goto('/dashboard');
            const adminSidebar = adminPage.getByRole('complementary');
            await expect(
                adminSidebar.getByRole('link', { name: 'Jobs' })
            ).toBeVisible();
            await expect(
                adminSidebar.getByRole('link', { name: 'Dev Tools' })
            ).toBeVisible();
            await adminContext.close();
        }
    );

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

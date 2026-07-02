/**
 * Dashboard auth guard (proxy.ts). Runs on the bare smoke project (no
 * storageState) so the signed-out cases start genuinely unauthenticated; the
 * inverse-guard case opens its own context off the shared user state. Signing
 * in through the UI creates a fresh session, so it never invalidates the
 * shared `e2e/.auth/*.json` states other specs rely on.
 */
import { test, expect } from '@playwright/test';
import { REGULAR_USER, USER_STATE_PATH } from '../helpers/auth';

// A file id that need not exist — the guard/redirect is what's under test, not
// the row highlight (covered by @uc:files-deep-link-focus).
const DEEP_LINK = '/dashboard/files?file=deep-link-target';

test.describe('dashboard auth guard', () => {
    test(
        'signed-out visitor to a dashboard deep-link is redirected to sign-in with the path preserved',
        { tag: ['@page:/dashboard/files', '@uc:auth-guard-dashboard'] },
        async ({ page }) => {
            await page.goto(DEEP_LINK);

            await expect(page).toHaveURL(/\/sign-in\?redirect=/);
            const redirect = new URL(page.url()).searchParams.get('redirect');
            expect(redirect).toBe(DEEP_LINK);
        }
    );

    test(
        'signing in from a preserved deep-link lands back on the original URL',
        { tag: ['@page:/sign-in', '@uc:auth-guard-deep-link-round-trip'] },
        async ({ page }) => {
            await page.goto(DEEP_LINK);
            await expect(page).toHaveURL(/\/sign-in\?redirect=/);

            await page.getByLabel('Email').fill(REGULAR_USER.email);
            await page.getByLabel('Password').fill(REGULAR_USER.password);
            await page.getByRole('button', { name: 'Sign in' }).click();

            await expect(page).toHaveURL(
                /\/dashboard\/files\?file=deep-link-target$/,
                {
                    timeout: 15_000,
                }
            );
        }
    );

    test(
        'signed-in visitor to an auth page is forwarded to the dashboard',
        { tag: ['@page:/sign-in', '@uc:auth-guard-signed-in-redirect'] },
        async ({ browser }) => {
            const context = await browser.newContext({
                storageState: USER_STATE_PATH,
            });
            const page = await context.newPage();

            await page.goto('/sign-in');
            await expect(page).toHaveURL(/\/dashboard$/);

            await page.goto('/sign-up');
            await expect(page).toHaveURL(/\/dashboard$/);

            await context.close();
        }
    );
});

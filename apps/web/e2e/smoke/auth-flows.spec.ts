/**
 * Real auth flows through the UI. These run unauthenticated (bare smoke
 * project — no storageState) and create their own sessions, so they never
 * invalidate the shared `e2e/.auth/*.json` states used by other specs.
 */
import { test, expect } from '@playwright/test';
import { REGULAR_USER } from '../helpers/auth';
import { deleteUserByEmail } from '../helpers/db';

// Unique per run so a crashed previous run can't collide; cleaned in afterAll.
const SIGNUP_EMAIL = `signup-e2e-${Date.now()}@test.local`;
const SIGNUP_PASSWORD = 'signup-e2e-password-123';

test.describe('auth flows', () => {
    test.afterAll(async () => {
        await deleteUserByEmail(SIGNUP_EMAIL);
    });

    test(
        'sign up with email lands on dashboard and provisions a trial',
        { tag: ['@page:/sign-up', '@uc:sign-up-email', '@uc:trial-on-signup'] },
        async ({ page }) => {
            await page.goto('/sign-up');

            await page.getByLabel('Name').fill('Signup E2E');
            await page.getByLabel('Email').fill(SIGNUP_EMAIL);
            await page.getByLabel('Password').fill(SIGNUP_PASSWORD);
            await page.getByRole('button', { name: 'Create account' }).click();

            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

            // Trial starts at signup (not at plan selection): settings shows
            // a Trial badge and the Starter card is current.
            await page.goto('/dashboard/settings');
            await expect(page.getByText('Trial', { exact: true })).toBeVisible({
                timeout: 15_000,
            });
            const starterCard = page
                .getByRole('heading', { name: 'Starter', exact: true })
                .locator('..');
            await expect(starterCard.getByText('Current')).toBeVisible();
        }
    );

    test(
        'sign in with valid credentials lands on dashboard',
        { tag: ['@page:/sign-in', '@uc:sign-in-email'] },
        async ({ page }) => {
            await page.goto('/sign-in');

            await page.getByLabel('Email').fill(REGULAR_USER.email);
            await page.getByLabel('Password').fill(REGULAR_USER.password);
            await page.getByRole('button', { name: 'Sign in' }).click();

            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
        }
    );

    test(
        'sign in with wrong password shows an error and stays on page',
        { tag: ['@page:/sign-in', '@uc:sign-in-invalid-credentials'] },
        async ({ page }) => {
            await page.goto('/sign-in');

            await page.getByLabel('Email').fill(REGULAR_USER.email);
            await page.getByLabel('Password').fill('definitely-wrong-password');
            await page.getByRole('button', { name: 'Sign in' }).click();

            // BetterAuth returns "Invalid email or password" — assert the
            // semantic alert rather than exact copy so wording tweaks don't
            // break the test.
            await expect(page.getByRole('alert')).toBeVisible({
                timeout: 10_000,
            });
            await expect(page).toHaveURL(/\/sign-in/);
        }
    );

    test(
        'sign out from the user menu returns to the landing page',
        { tag: ['@page:/dashboard', '@uc:sign-out'] },
        async ({ page }) => {
            // Sign in through the UI first — this creates a fresh session, so
            // signing out here can't revoke the shared storageState sessions.
            await page.goto('/sign-in');
            await page.getByLabel('Email').fill(REGULAR_USER.email);
            await page.getByLabel('Password').fill(REGULAR_USER.password);
            await page.getByRole('button', { name: 'Sign in' }).click();
            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

            await page.getByRole('button', { name: 'User menu' }).click();
            await page.getByRole('menuitem', { name: 'Sign out' }).click();

            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
        }
    );
});

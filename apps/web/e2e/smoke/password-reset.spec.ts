/**
 * Password reset, end to end minus the mailbox. The reset email itself never
 * sends here (e2e runs against a placeholder Resend key), so the request half
 * is exercised with an address that has no account — BetterAuth answers those
 * neutrally without ever calling the send callback — and the completion half
 * seeds the token straight into `verification`, which is what the emailed link
 * would have carried.
 *
 * Runs unauthenticated (bare smoke project — no storageState) and creates its
 * own user, so it can't invalidate the shared `e2e/.auth/*.json` states.
 */
import { test, expect } from '@playwright/test';
import {
    deletePasswordResetToken,
    deleteUserByEmail,
    findUserByEmail,
    insertPasswordResetToken,
} from '@nexus/db/test-db';
import { RESET_PASSWORD_TOKEN_TTL_SECONDS } from '@/lib/auth/constants';
import { signUpViaUi, uniqueTestEmail } from '../helpers/auth';
import { withTestDb } from '../helpers/connection';

const RESET_USER = {
    email: uniqueTestEmail('reset-e2e'),
    password: 'reset-e2e-original-123',
    name: 'Reset E2E',
};
const NEW_PASSWORD = 'reset-e2e-changed-456';
const RESET_TOKEN = `reset-e2e-token-${Date.now()}-${process.pid}`;

test.describe('password reset', () => {
    test.afterAll(async () => {
        await withTestDb(async (db) => {
            await deletePasswordResetToken(db, RESET_TOKEN);
            await deleteUserByEmail(db, RESET_USER.email);
        });
    });

    test(
        'requesting a reset confirms without revealing whether the account exists',
        { tag: ['@page:/forgot-password', '@uc:password-reset-request'] },
        async ({ page }) => {
            await page.goto('/forgot-password');

            // No account for this address: the endpoint must still answer as
            // if there were one.
            const unknownEmail = uniqueTestEmail('no-such-user');
            await page.getByLabel('Email').fill(unknownEmail);
            await page.getByRole('button', { name: 'Send reset link' }).click();

            await expect(page.getByRole('status')).toContainText(
                /if an account exists/i,
                { timeout: 10_000 }
            );
            await expect(page.getByRole('status')).toContainText(unknownEmail);
        }
    );

    test(
        'a valid token sets a new password, kills the old session, and the new password signs in',
        { tag: ['@page:/reset-password', '@uc:password-reset-complete'] },
        async ({ page }) => {
            // Sign up through the UI so the account has a real credential to
            // overwrite — and a live session for the reset to revoke.
            await signUpViaUi(page, RESET_USER);

            await withTestDb(async (db) => {
                const user = await findUserByEmail(db, RESET_USER.email);
                expect(user).toBeDefined();
                await insertPasswordResetToken(db, {
                    userId: user!.id,
                    token: RESET_TOKEN,
                    expiresAt: new Date(
                        Date.now() + RESET_PASSWORD_TOKEN_TTL_SECONDS * 1000
                    ),
                });
            });

            await page.goto(`/reset-password?token=${RESET_TOKEN}`);
            await page.getByLabel('New password').fill(NEW_PASSWORD);
            await page
                .getByRole('button', { name: 'Set new password' })
                .click();

            await expect(page.getByRole('status')).toContainText(
                /password has been changed/i,
                { timeout: 15_000 }
            );

            // Landing on /sign-in (not bounced to /dashboard) is the proof the
            // revoked session's cookie was cleared along with it.
            await page.getByRole('link', { name: 'Sign in' }).click();
            await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });

            await page.getByLabel('Email').fill(RESET_USER.email);
            await page.getByLabel('Password').fill(NEW_PASSWORD);
            await page.getByRole('button', { name: 'Sign in' }).click();

            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
        }
    );

    test(
        'an unusable reset link explains itself instead of crashing',
        { tag: ['@page:/reset-password', '@uc:password-reset-invalid-token'] },
        async ({ page }) => {
            // No token at all — caught before any API call.
            await page.goto('/reset-password');
            await expect(
                page.getByRole('heading', { name: /isn.t usable/i })
            ).toBeVisible();

            // A token the server has never issued — caught on submit. Filter to
            // the text-bearing alert: a production build also renders Next's
            // empty role="alert" route announcer.
            await page.goto('/reset-password?token=not-a-real-reset-token');
            await page.getByLabel('New password').fill(NEW_PASSWORD);
            await page
                .getByRole('button', { name: 'Set new password' })
                .click();

            await expect(
                page.getByRole('alert').filter({ hasText: /\S/ })
            ).toBeVisible({ timeout: 10_000 });
            await expect(page).toHaveURL(/\/reset-password/);
        }
    );
});

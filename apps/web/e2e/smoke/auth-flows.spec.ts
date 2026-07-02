/**
 * Real auth flows through the UI. These run unauthenticated (bare smoke
 * project — no storageState) and create their own sessions, so they never
 * invalidate the shared `e2e/.auth/*.json` states used by other specs.
 */
import { test, expect } from '@playwright/test';
import { REGULAR_USER } from '../helpers/auth';
import {
    deleteInvite,
    deleteUserByEmail,
    findUserByEmail,
    insertInvite,
} from '@nexus/db/test-db';
import { createTestDb } from '../helpers/connection';

// Unique per run so a crashed previous run can't collide; cleaned in afterAll.
const SIGNUP_EMAIL = `signup-e2e-${Date.now()}@test.local`;
const SIGNUP_PASSWORD = 'signup-e2e-password-123';

// Sponsored-invite redemption seeds a pending invite before the run and drops
// it after. The token/email are unique per run. The invite's createdBy points
// at the already-seeded REGULAR_USER (created durably by the setup project)
// rather than a throwaway user — one insert against a committed FK target, so
// the invite's foreign key can't lose a race on the transaction-mode pooler.
const INVITE_SIGNUP_EMAIL = `invite-e2e-${Date.now()}@test.local`;
const INVITE_TOKEN = `invite-e2e-token-${Date.now()}`;
let inviteId: string;

test.describe('auth flows', () => {
    test.beforeAll(async () => {
        const db = createTestDb();
        try {
            const creator = await findUserByEmail(db, REGULAR_USER.email);
            if (!creator) {
                throw new Error(
                    'REGULAR_USER must be seeded by the setup project before this spec'
                );
            }
            const invite = await insertInvite(db, {
                token: INVITE_TOKEN,
                createdBy: creator.id,
            });
            inviteId = invite.id;
        } finally {
            await db.$client.end({ timeout: 5 });
        }
    });

    test.afterAll(async () => {
        // These tests run unauthenticated (outside the fixture chain), so use a
        // direct connection rather than the worker `db` fixture.
        const db = createTestDb();
        try {
            await deleteUserByEmail(db, SIGNUP_EMAIL);
            // Drop the redeemer first (nulls redeemedByUserId via ON DELETE SET
            // NULL), then the invite. The creator is the shared REGULAR_USER —
            // never delete it.
            await deleteUserByEmail(db, INVITE_SIGNUP_EMAIL);
            await deleteInvite(db, inviteId);
        } finally {
            await db.$client.end({ timeout: 5 });
        }
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
        'redeeming an invite provisions sponsored access and hides trial UI',
        {
            tag: [
                '@page:/invite/[token]',
                '@uc:invite-redemption',
                '@uc:sponsored-on-signup',
            ],
        },
        async ({ page }) => {
            await page.goto(`/invite/${INVITE_TOKEN}`);

            await page.getByLabel('Name').fill('Invite E2E');
            await page.getByLabel('Email').fill(INVITE_SIGNUP_EMAIL);
            await page.getByLabel('Password').fill(SIGNUP_PASSWORD);
            await page.getByRole('button', { name: 'Create account' }).click();

            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

            // Settings shows the Sponsored badge and never any trial UI —
            // sponsored rows are 'sponsored'/trialEnd null, so the trial
            // countdown and TRIAL_EXPIRED banner can't render for them.
            await page.goto('/dashboard/settings');
            await expect(
                page.getByText('Sponsored', { exact: true })
            ).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText('Trial', { exact: true })).toHaveCount(
                0
            );
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
            // break the test. Filter to the text-bearing alert: a production
            // build also renders Next's empty role="alert" route announcer,
            // which would otherwise make getByRole('alert') ambiguous.
            await expect(
                page.getByRole('alert').filter({ hasText: /\S/ })
            ).toBeVisible({
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

/**
 * Sponsored invite redemption (#246). Runs unauthenticated (bare smoke
 * project) like auth-flows.spec.ts: redemption happens at signup, so these
 * tests create their own sessions and never touch the shared storage states.
 */
import { test, expect } from '@playwright/test';
import {
    findUserByEmail,
    insertInvite,
    deleteInvite,
    deleteUserByEmail,
    type Invite,
} from '@nexus/db/test-db';
import { ADMIN_USER } from '../helpers/auth';
import { createTestDb } from '../helpers/connection';
import { setupConsoleErrorTracking } from '../utils';

// Unique per run so a crashed previous run can't collide; cleaned in afterAll.
const SIGNUP_EMAIL = `sponsored-e2e-${Date.now()}@test.local`;
const BOUND_EMAIL = `invite-bound-e2e-${Date.now()}@test.local`;
const SIGNUP_PASSWORD = 'sponsored-e2e-password-123';

test.describe('invite redemption', () => {
    let db: ReturnType<typeof createTestDb>;
    let openInvite: Invite;
    let redeemableInvite: Invite;
    let boundInvite: Invite;
    let expiredInvite: Invite;

    test.beforeAll(async () => {
        // These tests run outside the fixture chain (no worker `db` fixture),
        // so hold a direct connection for seeding and cleanup.
        db = createTestDb();
        // Seeded invites need a real creator; the shared admin user is
        // guaranteed by the setup project.
        const admin = await findUserByEmail(db, ADMIN_USER.email);
        if (!admin) throw new Error('Shared admin e2e user not found');

        openInvite = await insertInvite(db, { createdBy: admin.id });
        // The redemption test consumes its invite; tests run fully parallel,
        // so it gets its own row — sharing openInvite would let scheduling
        // order decide whether the render test sees a pending invite.
        redeemableInvite = await insertInvite(db, { createdBy: admin.id });
        boundInvite = await insertInvite(db, {
            createdBy: admin.id,
            email: BOUND_EMAIL,
        });
        expiredInvite = await insertInvite(db, {
            createdBy: admin.id,
            expiresAt: new Date(Date.now() - 60_000),
        });
    });

    test.afterAll(async () => {
        try {
            await deleteInvite(db, openInvite.id);
            await deleteInvite(db, redeemableInvite.id);
            await deleteInvite(db, boundInvite.id);
            await deleteInvite(db, expiredInvite.id);
            await deleteUserByEmail(db, SIGNUP_EMAIL);
        } finally {
            await db.$client.end({ timeout: 5 });
        }
    });

    test(
        'valid invite renders the sponsored signup without console errors',
        { tag: ['@page:/invite/[token]'] },
        async ({ page }) => {
            const errors = setupConsoleErrorTracking(page);

            await page.goto(`/invite/${openInvite.token}`);

            await expect(
                page.getByRole('heading', { name: /you.re invited/i })
            ).toBeVisible();
            await expect(page.getByText('Sponsored access')).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Create account' })
            ).toBeVisible();

            expect(errors).toEqual([]);
        }
    );

    test(
        'email-bound invite pre-fills the email read-only',
        { tag: ['@page:/invite/[token]', '@uc:invite-email-locked'] },
        async ({ page }) => {
            await page.goto(`/invite/${boundInvite.token}`);

            const emailInput = page.getByLabel('Email');
            await expect(emailInput).toHaveValue(BOUND_EMAIL);
            await expect(emailInput).toHaveAttribute('readonly', '');
            await expect(
                page.getByText('Your invite is for this email address.')
            ).toBeVisible();
        }
    );

    test(
        'invalid and expired links show a friendly message instead of signup',
        { tag: ['@page:/invite/[token]', '@uc:invite-invalid-state'] },
        async ({ page }) => {
            await page.goto('/invite/definitely-not-a-real-token');
            await expect(
                page.getByRole('heading', { name: /isn.t valid/i })
            ).toBeVisible();
            await expect(page.getByLabel('Password')).toHaveCount(0);

            await page.goto(`/invite/${expiredInvite.token}`);
            await expect(
                page.getByRole('heading', { name: /has expired/i })
            ).toBeVisible();
            await expect(page.getByLabel('Password')).toHaveCount(0);
        }
    );

    test(
        'redeeming an invite provisions sponsored access with no trial UI',
        {
            tag: [
                '@page:/invite/[token]',
                '@uc:invite-redeem-sponsored',
                '@uc:sponsored-no-trial-ui',
            ],
        },
        async ({ page }) => {
            await page.goto(`/invite/${redeemableInvite.token}`);

            await page.getByLabel('Name').fill('Sponsored E2E');
            await page.getByLabel('Email').fill(SIGNUP_EMAIL);
            await page.getByLabel('Password').fill(SIGNUP_PASSWORD);
            await page.getByRole('button', { name: 'Create account' }).click();

            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

            // Settings shows the Sponsored badge and — the #246 assertion —
            // no trial UI anywhere on the page (badge or countdown copy).
            await page.goto('/dashboard/settings');
            await expect(
                page.getByText('Sponsored', { exact: true })
            ).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(/trial/i)).toHaveCount(0);

            // The invite is single-use: revisiting the link must say so.
            await page.goto(`/invite/${redeemableInvite.token}`);
            await expect(
                page.getByRole('heading', { name: /already been used/i })
            ).toBeVisible();
        }
    );
});

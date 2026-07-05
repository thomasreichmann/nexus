import { test, expect } from '../../fixtures';
import {
    ensureTrialSubscription,
    markSubscriptionPaid,
    markSubscriptionSponsored,
} from '@nexus/db/test-db';
import { interceptTrpcCalls } from '../../helpers/trpc';

test.use({ userRole: 'user' });

test.describe('Subscription tier change', () => {
    // Tier-change tests share the seeded user and mutate its subscription
    // row. Serializing avoids races within this file; other smoke files
    // don't read subscription state, so cross-file races aren't an issue.
    test.describe.configure({ mode: 'serial' });

    test.afterEach(async ({ db, seedUserId }) => {
        await ensureTrialSubscription(db, seedUserId);
    });

    test(
        'starter trial user sees Current badge on Starter card',
        {
            tag: [
                '@page:/dashboard/settings',
                '@uc:subscription-current-plan-badge',
            ],
        },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/settings');

            const starterCard = page
                .getByRole('heading', { name: 'Starter', exact: true })
                .locator('..');
            await expect(starterCard.getByText('Current')).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );

    // Regression guard for the duplicate-subscription bug: clicking Upgrade
    // for a customer with an active Stripe subscription must route through
    // the portal (which swaps the price) rather than Checkout (which would
    // create a second active subscription on the same customer).
    test(
        'paid Pro user clicking Upgrade Max routes to portal, not checkout',
        { tag: ['@uc:subscription-upgrade-paid-portal'] },
        async ({ page, db, seedUserId }) => {
            await markSubscriptionPaid(db, seedUserId, { tier: 'pro' });

            // Record which mutation fired then abort so neither hits Stripe
            // nor triggers a real navigation. The handler observes before
            // aborting, so a single instrumentation point covers both
            // concerns.
            const checkoutCalls = await interceptTrpcCalls(
                page,
                'subscriptions.createCheckoutSession'
            );
            const portalCalls = await interceptTrpcCalls(
                page,
                'subscriptions.createPortalSession'
            );

            await page.goto('/dashboard/settings');

            const maxCard = page
                .getByRole('heading', { name: 'Max', exact: true })
                .locator('..');
            await maxCard.getByRole('button', { name: 'Upgrade' }).click();

            await expect.poll(() => portalCalls.length).toBe(1);
            expect(checkoutCalls).toEqual([]);
            // No `consoleErrors` assertion: the aborted mutation surfaces a
            // network error in the console by design.
        }
    );

    test(
        'trial user clicking Upgrade routes to Stripe Checkout',
        { tag: ['@uc:subscription-upgrade-trial-checkout'] },
        async ({ page }) => {
            // Default seeded state: trialing, no stripeSubscriptionId → the
            // upgrade path must create a Checkout session, not a portal one.
            const checkoutCalls = await interceptTrpcCalls(
                page,
                'subscriptions.createCheckoutSession'
            );
            const portalCalls = await interceptTrpcCalls(
                page,
                'subscriptions.createPortalSession'
            );

            await page.goto('/dashboard/settings');

            const proCard = page
                .getByRole('heading', { name: 'Pro', exact: true })
                .locator('..');
            await proCard.getByRole('button', { name: 'Upgrade' }).click();

            await expect.poll(() => checkoutCalls.length).toBe(1);
            expect(portalCalls).toEqual([]);
        }
    );

    test(
        'billing interval toggle switches monthly and annual prices',
        { tag: ['@page:/dashboard/settings', '@uc:billing-interval-toggle'] },
        async ({ page, consoleErrors }) => {
            await page.goto('/dashboard/settings');

            const proCard = page
                .getByRole('heading', { name: 'Pro', exact: true })
                .locator('..');
            await expect(proCard.getByText('$12')).toBeVisible();
            await expect(proCard.getByText('/mo')).toBeVisible();

            await page.getByRole('button', { name: 'Annual' }).click();
            await expect(proCard.getByText('$120')).toBeVisible();
            await expect(proCard.getByText('/yr')).toBeVisible();

            // '/mo' is the discriminator: a non-exact '$12' alone would also
            // match the '$120' annual price, passing even if the toggle broke.
            await page.getByRole('button', { name: 'Monthly' }).click();
            await expect(proCard.getByText('$12')).toBeVisible();
            await expect(proCard.getByText('/mo')).toBeVisible();

            expect(consoleErrors).toEqual([]);
        }
    );

    test(
        'Manage billing is disabled on trial and enabled with an active sub',
        { tag: ['@uc:manage-billing-portal'] },
        async ({ page, db, seedUserId }) => {
            // Trial (no Stripe subscription) → disabled.
            await page.goto('/dashboard/settings');
            await expect(
                page.getByRole('button', { name: 'Manage billing' })
            ).toBeDisabled();

            // Paid subscription → enabled.
            await markSubscriptionPaid(db, seedUserId, { tier: 'pro' });
            await page.reload();
            await expect(
                page.getByRole('button', { name: 'Manage billing' })
            ).toBeEnabled({ timeout: 15_000 });
        }
    );

    test(
        'sponsored user sees sponsored panel with no billing controls',
        {
            tag: [
                '@page:/dashboard/settings',
                '@uc:subscription-sponsored-panel',
            ],
        },
        async ({ page, db, seedUserId, consoleErrors }) => {
            await markSubscriptionSponsored(db, seedUserId);
            await page.goto('/dashboard/settings');

            const panel = page
                .getByText('Sponsored by Nexus', { exact: true })
                .locator('..');
            await expect(panel).toBeVisible();
            // 2 TB is the helper default, not PLAN_LIMITS.max (10 TB) —
            // proves the panel reads subscription.storageLimit, not the
            // tier constant.
            await expect(panel.getByText('2 TB')).toBeVisible();

            await expect(
                page.getByRole('button', { name: 'Upgrade' })
            ).toHaveCount(0);
            await expect(
                page.getByRole('button', { name: 'Downgrade' })
            ).toHaveCount(0);
            await expect(
                page.getByRole('button', { name: 'Manage billing' })
            ).toHaveCount(0);
            await expect(
                page.getByRole('group', { name: 'Billing interval' })
            ).toHaveCount(0);
            await expect(
                page.getByRole('heading', { name: 'Starter', exact: true })
            ).toHaveCount(0);

            expect(consoleErrors).toEqual([]);
        }
    );
});

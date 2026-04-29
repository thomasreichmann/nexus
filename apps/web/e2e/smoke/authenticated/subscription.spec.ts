import { test, expect } from '../../fixtures/authenticated';
import { REGULAR_USER } from '../../helpers/auth';
import {
    findUserByEmail,
    markSubscriptionPaid,
    resetSubscriptionToTrial,
} from '../../helpers/db';

test.use({ userRole: 'user' });

// Tier-change behavior tests share the seeded user and mutate its
// subscription row. Serializing avoids races between this file's tests; other
// smoke files don't read subscription state, so cross-file races aren't an
// issue.
test.describe.serial('Subscription tier change', () => {
    let userId: string;

    test.beforeAll(async () => {
        const user = await findUserByEmail(REGULAR_USER.email);
        if (!user) throw new Error('seeded regular user not found');
        userId = user.id;
    });

    test.afterEach(async () => {
        await resetSubscriptionToTrial(userId);
    });

    test('starter trial user sees Current badge on Starter card', async ({
        page,
    }) => {
        await page.goto('/dashboard/settings');

        const starterCard = page
            .getByRole('heading', { name: 'Starter', exact: true })
            .locator('..');
        await expect(starterCard.getByText('Current')).toBeVisible();
    });

    // Regression guard for the duplicate-subscription bug: clicking Upgrade
    // for a customer with an active Stripe subscription must route through
    // the portal (which swaps the price) rather than Checkout (which would
    // create a second active subscription on the same customer).
    test('paid Pro user clicking Upgrade Max routes to portal, not checkout', async ({
        page,
    }) => {
        await markSubscriptionPaid(userId, { tier: 'pro' });

        const trpcCalls: string[] = [];
        page.on('request', (req) => {
            const url = req.url();
            if (url.includes('subscriptions.createCheckoutSession')) {
                trpcCalls.push('checkout');
            } else if (url.includes('subscriptions.createPortalSession')) {
                trpcCalls.push('portal');
            }
        });

        // Abort both mutations so neither hits Stripe nor triggers a real
        // navigation; we only care which one the UI tried to fire.
        await page.route(
            '**/api/trpc/subscriptions.createCheckoutSession**',
            (route) => route.abort()
        );
        await page.route(
            '**/api/trpc/subscriptions.createPortalSession**',
            (route) => route.abort()
        );

        await page.goto('/dashboard/settings');

        const maxCard = page
            .getByRole('heading', { name: 'Max', exact: true })
            .locator('..');
        await maxCard.getByRole('button', { name: 'Upgrade' }).click();

        await expect.poll(() => trpcCalls).toContain('portal');
        expect(trpcCalls).not.toContain('checkout');
    });
});

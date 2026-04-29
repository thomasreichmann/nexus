import { test, expect } from '../../fixtures/authenticated';
import { REGULAR_USER } from '../../helpers/auth';
import {
    ensureTrialSubscription,
    findUserByEmail,
    markSubscriptionPaid,
} from '../../helpers/db';

test.use({ userRole: 'user' });

test.describe('Subscription tier change', () => {
    // Tier-change tests share the seeded user and mutate its subscription
    // row. Serializing avoids races within this file; other smoke files
    // don't read subscription state, so cross-file races aren't an issue.
    test.describe.configure({ mode: 'serial' });

    let userId: string;

    test.beforeAll(async () => {
        const user = await findUserByEmail(REGULAR_USER.email);
        if (!user) throw new Error('seeded regular user not found');
        userId = user.id;
    });

    test.afterEach(async () => {
        await ensureTrialSubscription(userId);
    });

    test('starter trial user sees Current badge on Starter card', async ({
        page,
        consoleErrors,
    }) => {
        await page.goto('/dashboard/settings');

        const starterCard = page
            .getByRole('heading', { name: 'Starter', exact: true })
            .locator('..');
        await expect(starterCard.getByText('Current')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });

    // Regression guard for the duplicate-subscription bug: clicking Upgrade
    // for a customer with an active Stripe subscription must route through
    // the portal (which swaps the price) rather than Checkout (which would
    // create a second active subscription on the same customer).
    test('paid Pro user clicking Upgrade Max routes to portal, not checkout', async ({
        page,
    }) => {
        await markSubscriptionPaid(userId, { tier: 'pro' });

        // Record which mutation fired then abort so neither hits Stripe nor
        // triggers a real navigation. The handler observes before aborting,
        // so a single instrumentation point covers both concerns. Match the
        // path segment exactly (not a substring) so an httpBatchLink-batched
        // URL containing both procedure names can't satisfy both routes.
        const trpcCalls: string[] = [];
        await page.route(
            /\/api\/trpc\/subscriptions\.createCheckoutSession(\?|$)/,
            (route) => {
                trpcCalls.push('checkout');
                return route.abort();
            }
        );
        await page.route(
            /\/api\/trpc\/subscriptions\.createPortalSession(\?|$)/,
            (route) => {
                trpcCalls.push('portal');
                return route.abort();
            }
        );

        await page.goto('/dashboard/settings');

        const maxCard = page
            .getByRole('heading', { name: 'Max', exact: true })
            .locator('..');
        await maxCard.getByRole('button', { name: 'Upgrade' }).click();

        await expect.poll(() => trpcCalls).toEqual(['portal']);
        // No `consoleErrors` assertion: the aborted mutation surfaces a
        // network error in the console by design.
    });
});

/**
 * Asserts the Stripe account's config matches what the app expects (#293).
 *
 * Stripe products, prices, and webhook endpoints are configured by hand once
 * per mode (test vs live), so they can drift from the code's expectations
 * silently. Fails (exit 1) when:
 *   - a checkout tier (starter/pro/max) doesn't map to exactly one active
 *     product carrying `metadata.tier`
 *   - the 6 expected prices (3 tiers × month/year, amounts from
 *     PLAN_DISPLAY) aren't each exactly one active recurring USD price, or a
 *     tier product carries an active price outside those slots
 *   - no enabled webhook endpoint at /api/webhooks/stripe subscribes to all
 *     event types the app handles
 *
 * The mode checked is whatever STRIPE_SECRET_KEY selects (sk_test_ vs
 * sk_live_). CI runs test mode nightly (env-parity.yml); live mode joins
 * once #213 lands.
 *
 * Usage:
 *   pnpm -F web check:stripe-config
 *   STRIPE_SECRET_KEY=sk_live_... pnpm -F web check:stripe-config
 */

import type Stripe from 'stripe';

import { PLAN_DISPLAY } from '@/components/dashboard/subscriptionPlans';
import { alerts, getWorkflowRunUrl } from '@/lib/alerts';
import { stripeClient } from '@/lib/stripe/client';
import type { BillingInterval, CheckoutTier } from '@/lib/stripe/types';
import { BILLING_INTERVALS } from '@/lib/stripe/types';

// Keep in sync with dispatchWebhookEvent in server/services/subscriptions.ts
// — the switch there is the ground truth for what the app handles.
const EXPECTED_WEBHOOK_EVENTS = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
] as const;

const WEBHOOK_PATH = '/api/webhooks/stripe';

// Hosts that may legitimately serve the webhook (prod + the dev branch's
// custom domain). Pinning the host keeps a stale endpoint on a
// decommissioned deployment from satisfying the check while events go
// nowhere. Test mode currently points at the prod host (prod is test-mode
// Stripe until #213), so both hosts are valid in either mode.
const KNOWN_WEBHOOK_HOSTS = ['nexus.thomasar.dev', 'dev.nexus.thomasar.dev'];

interface ExpectedPrice {
    tier: CheckoutTier;
    interval: BillingInterval;
    unitAmount: number;
}

// PLAN_DISPLAY amounts are dollars; Stripe unit_amount is cents.
const expectedPrices: ExpectedPrice[] = PLAN_DISPLAY.flatMap((plan) =>
    BILLING_INTERVALS.map((interval) => ({
        tier: plan.tier,
        interval,
        unitAmount: plan.prices[interval] * 100,
    }))
);

// Stripe list calls auto-paginate when consumed as async iterables.
async function collectAll<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of iterable) {
        items.push(item);
    }
    return items;
}

function checkProducts(products: Stripe.Product[]): string[] {
    const failures: string[] = [];
    const tiers = PLAN_DISPLAY.map((plan) => plan.tier);

    for (const tier of tiers) {
        const matching = products.filter((p) => p.metadata?.tier === tier);
        if (matching.length === 1) {
            console.log(`  ✓ product for tier '${tier}': ${matching[0]!.id}`);
        } else {
            failures.push(
                `expected exactly 1 active product with metadata.tier='${tier}', found ${matching.length}` +
                    (matching.length > 0
                        ? ` (${matching.map((p) => p.id).join(', ')})`
                        : '')
            );
        }
    }
    return failures;
}

function checkPrices(prices: Stripe.Price[]): string[] {
    const failures: string[] = [];
    const checkoutTiers = new Set<string>(PLAN_DISPLAY.map((p) => p.tier));

    // Only prices attached to the checkout-tier products are constrained;
    // other products (e.g. one-off test products) are none of our business.
    const tierPrices = prices.filter((price) => {
        const product = price.product as Stripe.Product;
        return (
            typeof product === 'object' &&
            !('deleted' in product && product.deleted) &&
            checkoutTiers.has(product.metadata?.tier ?? '')
        );
    });

    for (const expected of expectedPrices) {
        const matching = tierPrices.filter((price) => {
            const product = price.product as Stripe.Product;
            return (
                product.metadata?.tier === expected.tier &&
                price.recurring?.interval === expected.interval
            );
        });
        const label = `${expected.tier}/${expected.interval}`;
        if (matching.length !== 1) {
            failures.push(
                `expected exactly 1 active price for ${label}, found ${matching.length}`
            );
            continue;
        }
        const price = matching[0]!;
        let isDrifted = false;
        if (price.unit_amount !== expected.unitAmount) {
            isDrifted = true;
            failures.push(
                `price ${price.id} (${label}): unit_amount ${price.unit_amount}, expected ${expected.unitAmount}`
            );
        }
        if (price.currency !== 'usd') {
            isDrifted = true;
            failures.push(
                `price ${price.id} (${label}): currency '${price.currency}', expected 'usd'`
            );
        }
        if (!isDrifted) {
            console.log(
                `  ✓ price ${label}: ${price.id} (${price.unit_amount} ${price.currency})`
            );
        }
    }

    // A price on a tier product outside the 6 expected slots is drift too
    // (e.g. a stale interval or a one-time price the app can't resolve).
    const unexpected = tierPrices.filter((price) => {
        const interval = price.recurring?.interval;
        return interval !== 'month' && interval !== 'year';
    });
    for (const price of unexpected) {
        const product = price.product as Stripe.Product;
        failures.push(
            `unexpected non-recurring/unknown-interval active price ${price.id} on tier product '${product.metadata?.tier}'`
        );
    }

    return failures;
}

function checkWebhookEndpoints(endpoints: Stripe.WebhookEndpoint[]): string[] {
    const candidates = endpoints.filter((endpoint) => {
        const url = new URL(endpoint.url);
        return (
            endpoint.status === 'enabled' &&
            url.pathname === WEBHOOK_PATH &&
            KNOWN_WEBHOOK_HOSTS.includes(url.hostname)
        );
    });

    const covering = candidates.filter((endpoint) => {
        const events = new Set(endpoint.enabled_events);
        return (
            events.has('*') ||
            EXPECTED_WEBHOOK_EVENTS.every((event) => events.has(event))
        );
    });

    if (covering.length > 0) {
        for (const endpoint of covering) {
            console.log(
                `  ✓ webhook endpoint ${endpoint.url} covers all ${EXPECTED_WEBHOOK_EVENTS.length} expected events`
            );
        }
        return [];
    }

    const inventory =
        endpoints.length === 0
            ? '(no webhook endpoints exist in this mode)'
            : endpoints
                  .map(
                      (endpoint) =>
                          `${endpoint.url} [${endpoint.status}] events: ${endpoint.enabled_events.join(', ')}`
                  )
                  .join('; ');
    return [
        `no enabled webhook endpoint at ${WEBHOOK_PATH} subscribes to all of: ${EXPECTED_WEBHOOK_EVENTS.join(', ')} — found: ${inventory}`,
    ];
}

async function main(): Promise<void> {
    const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
    // rk_ prefixes are restricted keys — still mode-carrying.
    const mode =
        secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')
            ? 'live'
            : 'test';
    console.log(`Checking Stripe config (${mode} mode)\n`);

    const [products, prices, webhookEndpoints] = await Promise.all([
        collectAll(stripeClient.products.list({ active: true, limit: 100 })),
        collectAll(
            stripeClient.prices.list({
                active: true,
                limit: 100,
                expand: ['data.product'],
            })
        ),
        collectAll(stripeClient.webhookEndpoints.list({ limit: 100 })),
    ]);

    console.log('Products:');
    const productFailures = checkProducts(products);
    console.log('Prices:');
    const priceFailures = checkPrices(prices);
    console.log('Webhook endpoints:');
    const webhookFailures = checkWebhookEndpoints(webhookEndpoints);

    const failures = [...productFailures, ...priceFailures, ...webhookFailures];
    for (const failure of failures) {
        console.log(`  ✗ ${failure}`);
    }

    if (failures.length > 0) {
        console.log(`\nCheck failed: Stripe ${mode}-mode config has drifted.`);
        process.exitCode = 1;

        // The exit-1 (and its workflow-failure email) stays as the dead-man
        // backup for the check itself; this pushes the findings where they
        // get seen (#288).
        const runUrl = getWorkflowRunUrl();
        await alerts.send({
            severity: 'error',
            title: `Stripe ${mode}-mode config drift detected`,
            message: failures.join('\n'),
            context: {
                source: 'check-stripe-config',
                mode,
                ...(runUrl && { workflowRun: runUrl }),
            },
        });
    } else {
        console.log('\nAll checks passed.');
    }
}

main().catch((err) => {
    console.error('Stripe config check aborted:', err);
    process.exitCode = 1;
});

import type Stripe from 'stripe';
import {
    CHECKOUT_TIERS,
    type CheckoutTier,
    type BillingInterval,
} from './types';
import { stripeClient } from './client';

// Cache the in-flight promise (not just the resolved Map) so concurrent first
// callers share a single Stripe pagination instead of stampeding.
let pricesPromise: Promise<Map<string, string>> | null = null;

function cacheKey(tier: CheckoutTier, interval: BillingInterval): string {
    return `${tier}:${interval}`;
}

function isCheckoutTier(value: string | undefined): value is CheckoutTier {
    return (
        value !== undefined &&
        (CHECKOUT_TIERS as readonly string[]).includes(value)
    );
}

async function loadPrices(): Promise<Map<string, string>> {
    const cache = new Map<string, string>();
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
        const params: Stripe.PriceListParams = {
            active: true,
            limit: 100,
            expand: ['data.product'],
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        };

        const page = await stripeClient.prices.list(params);

        for (const price of page.data) {
            const product = price.product as Stripe.Product;
            const tier = product.metadata?.tier;
            const interval = price.recurring?.interval;

            if (
                isCheckoutTier(tier) &&
                (interval === 'month' || interval === 'year')
            ) {
                cache.set(cacheKey(tier, interval), price.id);
            }
        }

        hasMore = page.has_more;
        if (page.data.length > 0) {
            startingAfter = page.data[page.data.length - 1].id;
        }
    }

    return cache;
}

/** Uses product metadata instead of hardcoded IDs so the same code works across Stripe environments. */
export async function resolvePriceId(
    tier: CheckoutTier,
    interval: BillingInterval
): Promise<string> {
    if (!pricesPromise) {
        pricesPromise = loadPrices().catch((err) => {
            // Don't pin a rejected promise — let the next call retry.
            pricesPromise = null;
            throw err;
        });
    }

    const cache = await pricesPromise;
    const priceId = cache.get(cacheKey(tier, interval));
    if (!priceId) {
        throw new Error(
            `No Stripe price found for tier="${tier}" interval="${interval}". ` +
                'Ensure products and prices are configured with correct metadata in the Stripe Dashboard.'
        );
    }

    return priceId;
}

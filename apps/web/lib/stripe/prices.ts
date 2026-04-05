import type Stripe from 'stripe';
import type { CheckoutTier, BillingInterval } from './types';
import { stripeClient } from './client';

/** Avoids repeated Stripe API calls; populated once per process, keyed by tier:interval. */
let priceCache: Map<string, string> | null = null;

function cacheKey(tier: CheckoutTier, interval: BillingInterval): string {
    return `${tier}:${interval}`;
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
            const tier = product.metadata?.tier as CheckoutTier | undefined;
            const interval = price.recurring?.interval as
                | BillingInterval
                | undefined;

            if (tier && interval) {
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
    if (!priceCache) {
        priceCache = await loadPrices();
    }

    const priceId = priceCache.get(cacheKey(tier, interval));
    if (!priceId) {
        throw new Error(
            `No Stripe price found for tier="${tier}" interval="${interval}". ` +
                'Ensure products and prices are configured with correct metadata in the Stripe Dashboard.'
        );
    }

    return priceId;
}

/** Call after adding or changing prices in the Stripe Dashboard. */
export function invalidatePriceCache(): void {
    priceCache = null;
}

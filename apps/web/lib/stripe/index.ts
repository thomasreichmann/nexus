import * as webhooks from './webhooks';
import * as checkout from './checkout';
import * as prices from './prices';

/**
 * Stripe payment processing operations
 *
 * @example
 * ```typescript
 * import { stripe } from '@/lib/stripe';
 *
 * // Verify webhook signature
 * const event = stripe.webhooks.constructEvent(rawBody, signature);
 *
 * // Create checkout session
 * const session = await stripe.checkout.createCheckoutSession({ ... });
 *
 * // Create billing portal session
 * const portal = await stripe.checkout.createBillingPortalSession(customerId, returnUrl);
 *
 * // Resolve price by metadata
 * const priceId = await stripe.prices.resolvePriceId('pro', 'month');
 * ```
 */
export const stripe = {
    webhooks,
    checkout,
    prices,
} as const;

// Re-export the client for direct SDK access
export { stripeClient } from './client';

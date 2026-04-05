import * as webhooks from './webhooks';
import * as checkout from './checkout';
import * as prices from './prices';

/** Namespace facade so consumers import a single entry point instead of individual modules. */
export const stripe = {
    webhooks,
    checkout,
    prices,
} as const;

// Re-export the client for direct SDK access
export { stripeClient } from './client';

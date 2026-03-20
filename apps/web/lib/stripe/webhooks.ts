import type Stripe from 'stripe';
import { env } from '@/lib/env';
import { stripeClient } from './client';

/** Throws on invalid signature — rawBody must not be re-serialized from JSON. */
export function constructEvent(
    rawBody: string,
    signature: string
): Stripe.Event {
    return stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET
    );
}

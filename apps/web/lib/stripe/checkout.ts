import type Stripe from 'stripe';
import { stripeClient } from './client';

interface CreateCheckoutSessionParams {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    mode?: Stripe.Checkout.SessionCreateParams.Mode;
}

export async function createCheckoutSession(
    params: CreateCheckoutSessionParams
): Promise<Stripe.Checkout.Session> {
    return stripeClient.checkout.sessions.create({
        customer: params.customerId,
        mode: params.mode ?? 'subscription',
        line_items: [{ price: params.priceId, quantity: 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
    });
}

export async function createBillingPortalSession(
    customerId: string,
    returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
    return stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
    });
}

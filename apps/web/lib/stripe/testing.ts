import { vi, type Mock } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

export interface MockStripeClient {
    customers: { create: AnyMock };
    products: { retrieve: AnyMock };
    prices: { list: AnyMock };
    checkout: { sessions: { create: AnyMock } };
    billingPortal: { sessions: { create: AnyMock } };
    webhooks: { constructEvent: AnyMock };
}

export interface MockStripeNamespace {
    webhooks: { constructEvent: AnyMock };
    checkout: {
        createCheckoutSession: AnyMock;
        createBillingPortalSession: AnyMock;
    };
    prices: { resolvePriceId: AnyMock };
}

export interface MockStripe {
    stripe: MockStripeNamespace;
    stripeClient: MockStripeClient;
}

/**
 * Creates a vitest stub for the `@/lib/stripe` module — both the `stripe`
 * namespace facade and the raw `stripeClient` SDK. Every method is `vi.fn()`
 * so individual tests can override behavior with `.mockResolvedValue(...)`
 * or `.mockRejectedValue(...)`.
 *
 * Wire it through `vi.hoisted` with a dynamic import — `vi.hoisted` runs
 * before static imports, so this file must be loaded asynchronously:
 *
 * ```ts
 * const hoisted = await vi.hoisted(async () => {
 *     const { createMockStripe } = await import('@/lib/stripe/testing');
 *     return createMockStripe();
 * });
 * vi.mock('@/lib/stripe', () => ({
 *     stripe: hoisted.stripe,
 *     stripeClient: hoisted.stripeClient,
 * }));
 * ```
 */
export function createMockStripe(): MockStripe {
    return {
        stripe: {
            webhooks: { constructEvent: vi.fn() },
            checkout: {
                createCheckoutSession: vi.fn(),
                createBillingPortalSession: vi.fn(),
            },
            prices: { resolvePriceId: vi.fn() },
        },
        stripeClient: {
            customers: { create: vi.fn() },
            products: { retrieve: vi.fn() },
            prices: { list: vi.fn() },
            checkout: { sessions: { create: vi.fn() } },
            billingPortal: { sessions: { create: vi.fn() } },
            webhooks: { constructEvent: vi.fn() },
        },
    };
}

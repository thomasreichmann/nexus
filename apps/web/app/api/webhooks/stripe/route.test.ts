import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { createWebhookEventFixture } from '@nexus/db/testing';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    const { createMockStripe } = await import('@/lib/stripe/testing');
    const { createMockDb } = await import('@nexus/db/testing');
    return {
        logger: createMockLogger(),
        ...createMockStripe(),
        mockDb: createMockDb(),
        dispatchWebhookEvent: vi.fn(),
    };
});

vi.mock('@/lib/env', () => ({
    env: {
        NEXT_PUBLIC_APP_URL: 'https://test.example',
        STRIPE_SECRET_KEY: 'sk_test',
    },
}));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

vi.mock('@/lib/stripe', () => ({
    stripe: hoisted.stripe,
    stripeClient: hoisted.stripeClient,
}));

// The route imports `db` directly, not through a factory. We point it at the
// shared mock db so test setup can drive it via `mocks.webhookEvents.findFirst`.
vi.mock('@/server/db', () => ({ db: hoisted.mockDb.db }));

vi.mock('@/server/services/subscriptions', () => ({
    subscriptionService: { dispatchWebhookEvent: hoisted.dispatchWebhookEvent },
}));

import { POST } from './route';

const constructEvent = hoisted.stripe.webhooks.constructEvent;
const dispatchWebhookEvent = hoisted.dispatchWebhookEvent;
const mocks = hoisted.mockDb.mocks;

function makeRequest(
    body: string | object,
    headers: Record<string, string> = {}
): NextRequest {
    return new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

const sampleEvent = {
    id: 'evt_test_123',
    type: 'customer.subscription.updated',
    data: { object: {} },
} as unknown as Stripe.Event;

describe('POST /api/webhooks/stripe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset shared mock state since vi.clearAllMocks does not reset
        // mockResolvedValue defaults set in createMockDb (e.g. returning -> []).
        mocks.returning.mockResolvedValue([]);
        mocks.webhookEvents.findFirst.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('production mode (signature verification)', () => {
        beforeEach(() => {
            vi.stubEnv('NODE_ENV', 'production');
        });

        it('returns 400 when stripe-signature header is missing', async () => {
            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toEqual({
                error: 'Missing stripe-signature header',
            });
            expect(constructEvent).not.toHaveBeenCalled();
        });

        it('returns 400 when signature verification fails', async () => {
            constructEvent.mockImplementation(() => {
                throw new Error('bad signature');
            });

            const response = await POST(
                makeRequest(sampleEvent, { 'stripe-signature': 'sig_bad' })
            );

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toEqual({
                error: 'Invalid signature',
            });
            expect(dispatchWebhookEvent).not.toHaveBeenCalled();
        });

        it('processes event when signature is valid', async () => {
            constructEvent.mockReturnValue(sampleEvent);
            mocks.returning.mockResolvedValue([
                createWebhookEventFixture({ externalId: sampleEvent.id }),
            ]);

            const response = await POST(
                makeRequest(sampleEvent, { 'stripe-signature': 'sig_good' })
            );

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ received: true });
            expect(dispatchWebhookEvent).toHaveBeenCalledWith(
                hoisted.mockDb.db,
                sampleEvent
            );
        });
    });

    describe('development mode (signature bypass)', () => {
        beforeEach(() => {
            vi.stubEnv('NODE_ENV', 'development');
        });

        it('parses event from raw JSON without signature', async () => {
            mocks.returning.mockResolvedValue([
                createWebhookEventFixture({ externalId: sampleEvent.id }),
            ]);

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            expect(constructEvent).not.toHaveBeenCalled();
            expect(dispatchWebhookEvent).toHaveBeenCalledWith(
                hoisted.mockDb.db,
                expect.objectContaining({ id: sampleEvent.id })
            );
        });

        it('returns 400 on malformed JSON body', async () => {
            const response = await POST(makeRequest('{ not json'));

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toEqual({
                error: 'Invalid JSON',
            });
            expect(dispatchWebhookEvent).not.toHaveBeenCalled();
        });
    });

    describe('idempotency', () => {
        beforeEach(() => {
            vi.stubEnv('NODE_ENV', 'development');
        });

        it('skips dispatch when event was already processed', async () => {
            mocks.webhookEvents.findFirst.mockResolvedValue(
                createWebhookEventFixture({
                    externalId: sampleEvent.id,
                    status: 'processed',
                })
            );

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
                received: true,
                duplicate: true,
            });
            expect(dispatchWebhookEvent).not.toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('retries dispatch when prior attempt failed', async () => {
            // Stripe redelivers a previously-failed event. The original record
            // exists with status 'failed' — this run should re-dispatch and
            // promote it to 'processed' on success.
            const failedRecord = createWebhookEventFixture({
                externalId: sampleEvent.id,
                status: 'failed',
                error: 'previous downstream error',
            });
            mocks.webhookEvents.findFirst.mockResolvedValue(failedRecord);
            dispatchWebhookEvent.mockResolvedValue(undefined);

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ received: true });
            expect(dispatchWebhookEvent).toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.set).toHaveBeenCalledWith({ status: 'processed' });
        });

        it('retries dispatch when prior attempt is still in received state', async () => {
            // Edge case: a prior crash left the row stuck on 'received'.
            // Stripe's retry should be allowed to drive it to a terminal state.
            mocks.webhookEvents.findFirst.mockResolvedValue(
                createWebhookEventFixture({
                    externalId: sampleEvent.id,
                    status: 'received',
                })
            );
            dispatchWebhookEvent.mockResolvedValue(undefined);

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            expect(dispatchWebhookEvent).toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('treats Postgres unique-violation on insert as a duplicate', async () => {
            // Concurrent redelivery: the find() race lost, the insert hits the
            // unique index. Production code should swallow code 23505 only.
            mocks.webhookEvents.findFirst.mockResolvedValue(undefined);
            const uniqueViolation = Object.assign(
                new Error('duplicate key value violates unique constraint'),
                { code: '23505' }
            );
            mocks.returning.mockRejectedValue(uniqueViolation);

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
                received: true,
                duplicate: true,
            });
            expect(dispatchWebhookEvent).not.toHaveBeenCalled();
        });

        it('rethrows non-unique-violation insert errors instead of masking them', async () => {
            // A schema mismatch or connection drop must NOT be silently
            // reported as a duplicate — Stripe needs to retry the delivery.
            mocks.webhookEvents.findFirst.mockResolvedValue(undefined);
            mocks.returning.mockRejectedValue(new Error('connection refused'));

            await expect(POST(makeRequest(sampleEvent))).rejects.toThrow(
                'connection refused'
            );
            expect(dispatchWebhookEvent).not.toHaveBeenCalled();
        });
    });

    describe('dispatch outcome', () => {
        beforeEach(() => {
            vi.stubEnv('NODE_ENV', 'development');
            mocks.returning.mockResolvedValue([
                createWebhookEventFixture({ externalId: sampleEvent.id }),
            ]);
        });

        it('marks event processed and returns 200 on success', async () => {
            dispatchWebhookEvent.mockResolvedValue(undefined);

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ received: true });
            expect(mocks.update).toHaveBeenCalled();
            expect(mocks.set).toHaveBeenCalledWith({ status: 'processed' });
        });

        it('marks event failed with error message on dispatch error', async () => {
            dispatchWebhookEvent.mockRejectedValue(
                new Error('downstream exploded')
            );

            const response = await POST(makeRequest(sampleEvent));

            // Failed events still return 200 — see #201 for the retry-loss tradeoff
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ received: true });
            expect(mocks.set).toHaveBeenCalledWith({
                status: 'failed',
                error: 'downstream exploded',
            });
        });

        it('stringifies non-Error throws when marking failed', async () => {
            dispatchWebhookEvent.mockRejectedValue('plain string failure');

            const response = await POST(makeRequest(sampleEvent));

            expect(response.status).toBe(200);
            expect(mocks.set).toHaveBeenCalledWith({
                status: 'failed',
                error: 'plain string failure',
            });
        });
    });
});

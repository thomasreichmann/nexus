import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createWebhookEventFixture } from '@nexus/db/testing';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    const { createMockDb } = await import('@nexus/db/testing');
    return {
        logger: createMockLogger(),
        mockDb: createMockDb(),
        dispatch: vi.fn(),
        alertsSend: vi.fn(),
        verifySnsMessage: vi.fn(),
    };
});

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

vi.mock('@/lib/alerts', () => ({
    alerts: { send: hoisted.alertsSend },
}));

vi.mock('@/lib/sns/webhooks', () => ({
    verifySnsMessage: hoisted.verifySnsMessage,
}));

// The route imports `db` directly, not through a factory. We point it at the
// shared mock db so test setup can drive it via `mocks.webhookEvents.findFirst`.
vi.mock('@/server/db', () => ({ db: hoisted.mockDb.db }));

vi.mock('@/server/services/s3-restore', () => ({
    s3RestoreService: {
        dispatch: hoisted.dispatch,
        expectedUnhandledEvents: new Set(['ObjectRestore:Post']),
    },
}));

import { POST } from './route';

const dispatch = hoisted.dispatch;
const mocks = hoisted.mockDb.mocks;

const MESSAGE_ID = 'sns-msg-123';
const EVENT_NAME = 'ObjectRestore:Completed';

function makeNotification(eventName = EVENT_NAME): Record<string, unknown> {
    return {
        Type: 'Notification',
        MessageId: MESSAGE_ID,
        TopicArn: 'arn:aws:sns:us-east-1:123456789:nexus-s3-events-test',
        Message: JSON.stringify({
            Records: [
                {
                    eventName,
                    s3: {
                        bucket: { name: 'nexus-storage-files-dev' },
                        object: { key: 'users/u1/file.cr2' },
                    },
                },
            ],
        }),
    };
}

function makeRequest(body: object): NextRequest {
    return new NextRequest('http://localhost/api/webhooks/s3-restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function snsEventFixture(status: 'received' | 'processed' | 'failed') {
    return createWebhookEventFixture({
        source: 'sns',
        externalId: MESSAGE_ID,
        eventType: EVENT_NAME,
        status,
    });
}

describe('POST /api/webhooks/s3-restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Local dev bypasses signature verification, which keeps these tests
        // about dispatch and recovery rather than SNS crypto.
        vi.stubEnv('NODE_ENV', 'development');
        // Reset shared mock state since vi.clearAllMocks does not reset
        // mockResolvedValue defaults set in createMockDb (e.g. returning -> []).
        mocks.returning.mockResolvedValue([snsEventFixture('received')]);
        mocks.webhookEvents.findFirst.mockResolvedValue(undefined);
        dispatch.mockResolvedValue(true);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    describe('idempotency', () => {
        it('skips dispatch when the event was already processed', async () => {
            mocks.webhookEvents.findFirst.mockResolvedValue(
                snsEventFixture('processed')
            );

            const response = await POST(makeRequest(makeNotification()));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
                received: true,
                duplicate: true,
            });
            expect(dispatch).not.toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
        });

        it('re-drives a row a prior crash stranded at received', async () => {
            // The strand this issue is about: the route inserts at 'received'
            // and only moves the row after dispatch, so a crash in between
            // used to make the event permanently undeliverable (#331).
            mocks.webhookEvents.findFirst.mockResolvedValue(
                snsEventFixture('received')
            );

            const response = await POST(makeRequest(makeNotification()));

            expect(response.status).toBe(200);
            expect(dispatch).toHaveBeenCalled();
            expect(mocks.insert).not.toHaveBeenCalled();
            expect(mocks.set).toHaveBeenCalledWith({ status: 'processed' });
        });

        it('re-drives a row a prior attempt marked failed', async () => {
            mocks.webhookEvents.findFirst.mockResolvedValue(
                snsEventFixture('failed')
            );

            const response = await POST(makeRequest(makeNotification()));

            expect(response.status).toBe(200);
            expect(dispatch).toHaveBeenCalled();
            expect(mocks.set).toHaveBeenCalledWith({ status: 'processed' });
        });

        it('treats Postgres unique-violation on insert as a duplicate', async () => {
            // Concurrent redelivery: the find() race lost, the insert hits the
            // unique index. Production code should swallow code 23505 only.
            mocks.returning.mockRejectedValue(
                Object.assign(
                    new Error('duplicate key value violates unique constraint'),
                    { code: '23505' }
                )
            );

            const response = await POST(makeRequest(makeNotification()));

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
                received: true,
                duplicate: true,
            });
            expect(dispatch).not.toHaveBeenCalled();
        });
    });

    describe('dispatch outcome', () => {
        it('marks the event failed and returns 200 on a business error', async () => {
            dispatch.mockRejectedValue(new Error('downstream exploded'));

            const response = await POST(makeRequest(makeNotification()));

            // A retry would hit the same bug, so the provider is told to stop.
            expect(response.status).toBe(200);
            expect(mocks.set).toHaveBeenCalledWith({
                status: 'failed',
                error: 'downstream exploded',
            });
            expect(hoisted.alertsSend).toHaveBeenCalledWith(
                expect.objectContaining({ severity: 'error' })
            );
        });

        it('rethrows transient infra failures so SNS redelivers', async () => {
            // Marking the row 'failed' would need the same database that just
            // went away, and nothing re-drives a failed row on its own — so
            // this becomes a 5xx and the row stays visible at 'received'.
            dispatch.mockRejectedValue(
                Object.assign(new Error('connection refused'), {
                    code: 'ECONNREFUSED',
                })
            );

            await expect(POST(makeRequest(makeNotification()))).rejects.toThrow(
                'connection refused'
            );
            expect(mocks.set).not.toHaveBeenCalled();
            expect(hoisted.alertsSend).not.toHaveBeenCalled();
        });
    });

    describe('subscription confirmation', () => {
        const confirmation = {
            Type: 'SubscriptionConfirmation',
            MessageId: 'sns-confirm-1',
            TopicArn: 'arn:aws:sns:us-east-1:123456789:nexus-s3-events-test',
            SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Confirm',
        };

        it('alerts when the SubscribeURL cannot be reached', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockRejectedValue(new Error('network down'))
            );

            const response = await POST(makeRequest(confirmation));

            expect(response.status).toBe(200);
            expect(hoisted.alertsSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    severity: 'error',
                    title: 'SNS subscription confirmation failed',
                    context: expect.objectContaining({
                        source: 'sns',
                        topicArn: confirmation.TopicArn,
                        error: 'network down',
                    }),
                })
            );
        });

        it('alerts when the SubscribeURL answers with an error status', async () => {
            // `fetch` resolves on a 4xx/5xx, so without an explicit check this
            // logged as confirmed while the topic stayed unsubscribed.
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(new Response('nope', { status: 403 }))
            );

            await POST(makeRequest(confirmation));

            expect(hoisted.alertsSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    severity: 'error',
                    title: 'SNS subscription confirmation failed',
                })
            );
        });

        it('does not alert when confirmation succeeds', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
            );

            await POST(makeRequest(confirmation));

            expect(hoisted.alertsSend).not.toHaveBeenCalled();
        });
    });
});

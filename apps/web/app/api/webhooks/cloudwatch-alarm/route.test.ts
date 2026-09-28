import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createWebhookEventFixture } from '@nexus/db/testing';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    const { createMockDb } = await import('@nexus/db/testing');
    return {
        logger: createMockLogger(),
        mockDb: createMockDb(),
        alertsSend: vi.fn(),
        verifySnsMessage: vi.fn(),
        confirmSnsSubscription: vi.fn(),
        env: {} as { SNS_OPS_ALERTS_TOPIC_ARN?: string },
    };
});

vi.mock('@/lib/env', () => ({ env: hoisted.env }));

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));

vi.mock('@/lib/alerts', () => ({
    alerts: { send: hoisted.alertsSend },
}));

// Signature verification is stubbed to pass: these tests are about topic
// origin, which only matters for messages that SNS genuinely signed.
vi.mock('@/lib/sns/webhooks', () => ({
    verifySnsMessage: hoisted.verifySnsMessage,
    confirmSnsSubscription: hoisted.confirmSnsSubscription,
}));

vi.mock('@/server/db', () => ({ db: hoisted.mockDb.db }));

import type {
    SnsNotification,
    SnsSubscriptionConfirmation,
} from '@/lib/sns/types';
import { POST } from './route';

const mocks = hoisted.mockDb.mocks;

const OPS_ALERTS_ARN =
    'arn:aws:sns:us-east-1:391615358272:nexus-ops-alerts-prod';
const FOREIGN_ARN = 'arn:aws:sns:us-east-1:999999999999:nexus-ops-alerts-prod';

function makeRequest(body: object): NextRequest {
    return new NextRequest('http://localhost/api/webhooks/cloudwatch-alarm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function makeSubscriptionConfirmation(
    topicArn: string
): SnsSubscriptionConfirmation {
    return {
        Type: 'SubscriptionConfirmation',
        MessageId: 'sub-123',
        TopicArn: topicArn,
        Timestamp: '2026-09-28T12:00:00.000Z',
        Message: 'You have chosen to subscribe...',
        SubscribeURL:
            'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
        Token: 'token',
    };
}

function makeAlarmNotification(topicArn: string): SnsNotification {
    return {
        Type: 'Notification',
        MessageId: 'msg-456',
        TopicArn: topicArn,
        Timestamp: '2026-09-28T12:00:00.000Z',
        Message: JSON.stringify({
            AlarmName: 'nexus-jobs-dlq-depth-prod',
            NewStateValue: 'ALARM',
            NewStateReason: 'Threshold Crossed',
        }),
    };
}

/** Nothing reached webhook_events, Discord, or the SubscribeURL. */
function expectNoSideEffects(): void {
    expect(hoisted.confirmSnsSubscription).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.findFirst).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(hoisted.alertsSend).not.toHaveBeenCalled();
}

describe('POST /api/webhooks/cloudwatch-alarm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.returning.mockResolvedValue([]);
        mocks.webhookEvents.findFirst.mockResolvedValue(undefined);
        hoisted.verifySnsMessage.mockResolvedValue(undefined);
        hoisted.env.SNS_OPS_ALERTS_TOPIC_ARN = OPS_ALERTS_ARN;
        vi.stubEnv('NODE_ENV', 'production');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe('deployed (topic check enforced)', () => {
        it('confirms a subscription from the ops-alerts topic', async () => {
            const response = await POST(
                makeRequest(makeSubscriptionConfirmation(OPS_ALERTS_ARN))
            );

            expect(response.status).toBe(200);
            expect(hoisted.confirmSnsSubscription).toHaveBeenCalledWith(
                expect.objectContaining({ TopicArn: OPS_ALERTS_ARN })
            );
        });

        it('delivers a notification from the ops-alerts topic', async () => {
            mocks.returning.mockResolvedValue([
                createWebhookEventFixture({ externalId: 'msg-456' }),
            ]);

            const response = await POST(
                makeRequest(makeAlarmNotification(OPS_ALERTS_ARN))
            );

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ received: true });
            expect(hoisted.alertsSend).toHaveBeenCalledWith(
                expect.objectContaining({ severity: 'critical' })
            );
        });

        it('rejects a subscription from a foreign topic without fetching SubscribeURL', async () => {
            const response = await POST(
                makeRequest(makeSubscriptionConfirmation(FOREIGN_ARN))
            );

            expect(response.status).toBe(403);
            expectNoSideEffects();
            expect(hoisted.logger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ topicArn: FOREIGN_ARN }),
                'Rejected SNS message from unexpected topic'
            );
        });

        // A foreign subscription confirmed before this check shipped keeps
        // delivering, so the Notification gate is the one that closes it.
        it('rejects a notification from a foreign topic', async () => {
            const response = await POST(
                makeRequest(makeAlarmNotification(FOREIGN_ARN))
            );

            expect(response.status).toBe(403);
            expectNoSideEffects();
        });

        it('rejects a message with no TopicArn at all', async () => {
            const body: Partial<SnsNotification> =
                makeAlarmNotification(OPS_ALERTS_ARN);
            delete body.TopicArn;

            const response = await POST(makeRequest(body));

            expect(response.status).toBe(403);
            expectNoSideEffects();
        });

        it('fails closed when the expected ARN is unset', async () => {
            hoisted.env.SNS_OPS_ALERTS_TOPIC_ARN = undefined;

            const confirmation = await POST(
                makeRequest(makeSubscriptionConfirmation(OPS_ALERTS_ARN))
            );
            const notification = await POST(
                makeRequest(makeAlarmNotification(OPS_ALERTS_ARN))
            );

            // 503, not 403: our misconfiguration, so SNS should retry and
            // dead-letter the alarm rather than discard it as a client error.
            expect(confirmation.status).toBe(503);
            expect(notification.status).toBe(503);
            expectNoSideEffects();
            expect(hoisted.logger.error).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'Notification' }),
                'SNS_OPS_ALERTS_TOPIC_ARN is unset; rejecting SNS message'
            );
        });

        // Same deployment signal as the signature bypass: NODE_ENV alone
        // can't switch the topic check off on Vercel.
        it('still checks the topic when NODE_ENV=development on Vercel', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            vi.stubEnv('VERCEL_ENV', 'preview');

            const response = await POST(
                makeRequest(makeAlarmNotification(FOREIGN_ARN))
            );

            expect(response.status).toBe(403);
            expectNoSideEffects();
        });

        it('rejects a bad signature before looking at the topic', async () => {
            hoisted.verifySnsMessage.mockRejectedValue(
                new Error('bad signature')
            );

            const response = await POST(
                makeRequest(makeAlarmNotification(FOREIGN_ARN))
            );

            expect(response.status).toBe(400);
            expectNoSideEffects();
            expect(hoisted.logger.warn).not.toHaveBeenCalledWith(
                expect.anything(),
                'Rejected SNS message from unexpected topic'
            );
        });
    });

    describe('local development (checks bypassed)', () => {
        it('accepts any topic with the ARN unset', async () => {
            vi.stubEnv('NODE_ENV', 'development');
            hoisted.env.SNS_OPS_ALERTS_TOPIC_ARN = undefined;

            const response = await POST(
                makeRequest(makeSubscriptionConfirmation(FOREIGN_ARN))
            );

            expect(response.status).toBe(200);
            expect(hoisted.verifySnsMessage).not.toHaveBeenCalled();
            expect(hoisted.confirmSnsSubscription).toHaveBeenCalled();
        });
    });
});

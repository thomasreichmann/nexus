import { NextResponse, type NextRequest } from 'next/server';
import { createWebhookRepo } from '@nexus/db/repo/webhooks';
import { alerts } from '@/lib/alerts';
import { isLocalDevelopment } from '@/lib/env/runtime';
import { isTransientInfraError, toErrorMessage } from '@/lib/errors';
import {
    recordWebhookFailure,
    resolveWebhookEvent,
} from '@/lib/webhooks/events';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';
import { verifySnsMessage } from '@/lib/sns/webhooks';
import type {
    SnsSubscriptionConfirmation,
    SnsNotification,
    S3EventNotification,
} from '@/lib/sns/types';
import { s3RestoreService } from '@/server/services/s3-restore';

const log = logger.child({ handler: 's3-restore-webhook' });

export async function POST(request: NextRequest): Promise<NextResponse> {
    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Signature verification is bypassed only on a local dev machine — every
    // deployed environment always verifies (see `isLocalDevelopment`).
    if (!isLocalDevelopment()) {
        try {
            await verifySnsMessage(body);
        } catch (err) {
            log.warn({ err }, 'SNS signature verification failed');
            return NextResponse.json(
                { error: 'Invalid signature' },
                { status: 400 }
            );
        }
    }

    const messageType = body.Type as string;

    if (messageType === 'SubscriptionConfirmation') {
        return handleSubscriptionConfirmation(
            body as unknown as SnsSubscriptionConfirmation
        );
    }

    if (messageType !== 'Notification') {
        log.debug(
            { type: messageType },
            'Ignoring non-notification SNS message'
        );
        return NextResponse.json({ received: true });
    }

    const notification = body as unknown as SnsNotification;
    const webhookRepo = createWebhookRepo(db);

    let s3Event: S3EventNotification;
    try {
        s3Event = JSON.parse(notification.Message) as S3EventNotification;
    } catch {
        log.error(
            { messageId: notification.MessageId },
            'Failed to parse S3 event from SNS message'
        );
        return NextResponse.json({ received: true });
    }

    const eventType = s3Event.Records?.[0]?.eventName ?? 'unknown';

    const lookup = await resolveWebhookEvent(webhookRepo, {
        source: 'sns',
        externalId: notification.MessageId,
        eventType,
        payload: body,
    });

    if (lookup.outcome === 'duplicate') {
        log.debug(
            {
                messageId: notification.MessageId,
                duplicate: true,
                reason: lookup.reason,
            },
            'Duplicate webhook event skipped'
        );
        return NextResponse.json({ received: true, duplicate: true });
    }

    if (lookup.outcome === 'retry') {
        log.info(
            {
                messageId: notification.MessageId,
                prevStatus: lookup.event.status,
            },
            'Retrying webhook event'
        );
    }

    const webhookEvent = lookup.event;

    const start = Date.now();
    log.info(
        { messageId: notification.MessageId, eventType },
        'Webhook event received'
    );

    try {
        const unhandledEventNames: string[] = [];
        for (const record of s3Event.Records ?? []) {
            const isHandled = await s3RestoreService.dispatch(db, record);

            if (!isHandled) {
                if (
                    s3RestoreService.expectedUnhandledEvents.has(
                        record.eventName
                    )
                ) {
                    log.debug(
                        { eventName: record.eventName },
                        'Expected-unhandled S3 event type'
                    );
                } else {
                    unhandledEventNames.push(record.eventName);
                    log.warn(
                        { eventName: record.eventName },
                        'Unhandled S3 event type'
                    );
                }
            }
        }

        const hasUnhandledRecord = unhandledEventNames.length > 0;
        // `error` is cleared, not left: a redelivery re-drives any row that
        // isn't `processed`, so a row arriving here may still carry the
        // message from the attempt that marked it `failed`.
        await webhookRepo.update(webhookEvent.id, {
            status: hasUnhandledRecord ? 'unhandled' : 'processed',
            error: null,
        });

        if (hasUnhandledRecord) {
            await alerts.send({
                severity: 'warning',
                title: 'Unhandled S3 event type',
                message:
                    'An SNS webhook delivered S3 event types no handler matches; the event row is marked unhandled.',
                context: {
                    source: 'sns',
                    eventType: unhandledEventNames.join(', '),
                    externalId: notification.MessageId,
                },
            });
        }

        log.info(
            {
                messageId: notification.MessageId,
                eventType,
                durationMs: Date.now() - start,
            },
            'Webhook event processed'
        );

        return NextResponse.json({ received: true });
    } catch (error) {
        log.error(
            { err: error, messageId: notification.MessageId, eventType },
            'Webhook processing failed'
        );

        // Rethrow so the 5xx makes SNS redeliver — see `isTransientInfraError`
        // for why nothing is written first (#331).
        if (isTransientInfraError(error)) throw error;

        await recordWebhookFailure(webhookRepo, webhookEvent.id, error, {
            title: 'S3 webhook processing failed',
            message:
                'Handler threw while processing an SNS webhook; the event row is marked failed.',
            context: {
                source: 'sns',
                eventType,
                externalId: notification.MessageId,
            },
        });

        return NextResponse.json({ received: true });
    }
}

async function handleSubscriptionConfirmation(
    message: SnsSubscriptionConfirmation
): Promise<NextResponse> {
    log.info({ topicArn: message.TopicArn }, 'Confirming SNS subscription');

    try {
        const response = await fetch(message.SubscribeURL);
        // `fetch` only rejects on a network failure, so an SNS-side 4xx/5xx
        // would otherwise log as confirmed while the topic stays unsubscribed.
        if (!response.ok) {
            throw new Error(
                `SubscribeURL returned ${response.status} ${response.statusText}`
            );
        }
        log.info({ topicArn: message.TopicArn }, 'SNS subscription confirmed');
    } catch (err) {
        // An unconfirmed subscription delivers nothing at all, so this is
        // louder than a log line: every restore notification is lost until
        // someone re-triggers confirmation (#331).
        log.error(
            { err, topicArn: message.TopicArn },
            'Failed to confirm SNS subscription'
        );

        await alerts.send({
            severity: 'error',
            title: 'SNS subscription confirmation failed',
            message:
                'Could not confirm an SNS subscription; the topic will not deliver events to this endpoint until it is confirmed.',
            context: {
                source: 'sns',
                topicArn: message.TopicArn,
                error: toErrorMessage(err),
            },
        });
    }

    return NextResponse.json({ received: true });
}

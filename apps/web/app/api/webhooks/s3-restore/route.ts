import { NextResponse, type NextRequest } from 'next/server';
import { createWebhookRepo } from '@nexus/db/repo/webhooks';
import { alerts } from '@/lib/alerts';
import { isLocalDevelopment } from '@/lib/env/runtime';
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

    const existing = await webhookRepo.find('sns', notification.MessageId);

    if (existing) {
        log.debug(
            { messageId: notification.MessageId, duplicate: true },
            'Duplicate webhook event skipped'
        );
        return NextResponse.json({ received: true, duplicate: true });
    }

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

    const webhookEvent = await webhookRepo.insert({
        source: 'sns',
        externalId: notification.MessageId,
        eventType,
        payload: body,
    });

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
        await webhookRepo.update(webhookEvent.id, {
            status: hasUnhandledRecord ? 'unhandled' : 'processed',
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

        const errorMessage =
            error instanceof Error ? error.message : String(error);
        await webhookRepo.update(webhookEvent.id, {
            status: 'failed',
            error: errorMessage,
        });

        await alerts.send({
            severity: 'error',
            title: 'S3 webhook processing failed',
            message:
                'Handler threw while processing an SNS webhook; the event row is marked failed.',
            context: {
                source: 'sns',
                eventType,
                externalId: notification.MessageId,
                error: errorMessage,
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
        await fetch(message.SubscribeURL);
        log.info({ topicArn: message.TopicArn }, 'SNS subscription confirmed');
    } catch (err) {
        log.error(
            { err, topicArn: message.TopicArn },
            'Failed to confirm SNS subscription'
        );
    }

    return NextResponse.json({ received: true });
}

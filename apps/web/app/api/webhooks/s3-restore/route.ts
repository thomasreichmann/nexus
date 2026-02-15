import { NextResponse, type NextRequest } from 'next/server';
import {
    findWebhookEvent,
    insertWebhookEvent,
    updateWebhookEvent,
} from '@nexus/db';
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

    if (process.env.NODE_ENV !== 'development') {
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

    const existing = await findWebhookEvent(db, 'sns', notification.MessageId);

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

    const webhookEvent = await insertWebhookEvent(db, {
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
        for (const record of s3Event.Records ?? []) {
            const isHandled = await s3RestoreService.dispatch(db, record);

            if (!isHandled) {
                log.debug(
                    { eventName: record.eventName },
                    'Unhandled S3 event type'
                );
            }
        }

        await updateWebhookEvent(db, webhookEvent.id, {
            status: 'processed',
        });

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

        await updateWebhookEvent(db, webhookEvent.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
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

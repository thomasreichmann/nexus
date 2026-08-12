import { NextResponse, type NextRequest } from 'next/server';
import { createWebhookRepo } from '@nexus/db/repo/webhooks';
import { alerts, type AlertSeverity } from '@/lib/alerts';
import { isLocalDevelopment } from '@/lib/env/runtime';
import { verifySnsMessage } from '@/lib/sns/webhooks';
import type {
    SnsSubscriptionConfirmation,
    SnsNotification,
} from '@/lib/sns/types';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';

const log = logger.child({ handler: 'cloudwatch-alarm-webhook' });

/**
 * CloudWatch alarm state changes -> Discord, via the ops-alerts SNS topic
 * (infra/terraform/alarms.tf). Same rail shape as /api/webhooks/s3-restore:
 * signature-verified envelope, auto-confirmed subscription, deduped and
 * audited through webhook_events.
 */

/** The SNS Message payload of a CloudWatch alarm state change. */
interface CloudWatchAlarmMessage {
    AlarmName?: string;
    AlarmDescription?: string | null;
    NewStateValue?: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
    NewStateReason?: string;
}

const SEVERITY_BY_STATE: Record<string, AlertSeverity> = {
    // Alarms reach this topic only for unattended failures nothing else
    // catches (alarms.tf), so any ALARM state pages loudly.
    ALARM: 'critical',
    OK: 'info',
    INSUFFICIENT_DATA: 'warning',
};

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

    let alarm: CloudWatchAlarmMessage;
    try {
        alarm = JSON.parse(notification.Message) as CloudWatchAlarmMessage;
    } catch {
        log.error(
            { messageId: notification.MessageId },
            'Failed to parse CloudWatch alarm from SNS message'
        );
        return NextResponse.json({ received: true });
    }

    const state = alarm.NewStateValue ?? 'UNKNOWN';
    const webhookEvent = await webhookRepo.insert({
        source: 'sns',
        externalId: notification.MessageId,
        eventType: `cloudwatch-alarm:${state}`,
        payload: body,
    });

    log.info(
        { messageId: notification.MessageId, alarm: alarm.AlarmName, state },
        'CloudWatch alarm state change received'
    );

    await alerts.send({
        severity: SEVERITY_BY_STATE[state] ?? 'warning',
        title: `CloudWatch alarm ${state}: ${alarm.AlarmName ?? 'unknown alarm'}`,
        message:
            alarm.NewStateReason ??
            alarm.AlarmDescription ??
            'No state reason provided.',
        context: {
            source: 'cloudwatch',
            alarm: alarm.AlarmName ?? 'unknown',
            state,
        },
    });

    await webhookRepo.update(webhookEvent.id, { status: 'processed' });

    return NextResponse.json({ received: true });
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

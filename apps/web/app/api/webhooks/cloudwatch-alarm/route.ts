import { NextResponse, type NextRequest } from 'next/server';
import { createWebhookRepo } from '@nexus/db/repo/webhooks';
import { alerts, type AlertSeverity } from '@/lib/alerts';
import { env } from '@/lib/env';
import { isLocalDevelopment } from '@/lib/env/runtime';
import { confirmSnsSubscription, verifySnsMessage } from '@/lib/sns/webhooks';
import { resolveWebhookEvent } from '@/lib/webhooks/events';
import type {
    SnsSubscriptionConfirmation,
    SnsNotification,
} from '@/lib/sns/types';
import { db } from '@/server/db';
import { logger } from '@/server/lib/logger';

const log = logger.child({ handler: 'cloudwatch-alarm-webhook' });

/**
 * CloudWatch alarm state changes -> Discord, via the ops-alerts SNS topic
 * (infra/terraform/alarms.tf): signature-verified envelope from that topic
 * only, auto-confirmed subscription, deduped and audited through
 * webhook_events.
 *
 * Recorded under `source: 'cloudwatch'` — the producer, not the transport.
 * This was the last writer of the old `'sns'` source, which #416 retired with
 * the S3 lifecycle rail.
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

    // Signature and topic checks are bypassed only on a local dev machine —
    // every deployed environment always runs both (see `isLocalDevelopment`).
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

        if (!isOpsAlertsTopic(body)) {
            return NextResponse.json(
                { error: 'Unexpected topic' },
                { status: 403 }
            );
        }
    }

    const messageType = body.Type as string;

    if (messageType === 'SubscriptionConfirmation') {
        await confirmSnsSubscription(
            body as unknown as SnsSubscriptionConfirmation
        );
        return NextResponse.json({ received: true });
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

    // Shared with the Stripe rail: only a `processed` row is really a
    // duplicate. A row left at `received` by a crash mid-dispatch has to be
    // re-driven when SNS redelivers, or it strands forever (#331).
    const lookup = await resolveWebhookEvent(webhookRepo, {
        source: 'cloudwatch',
        externalId: notification.MessageId,
        eventType: `cloudwatch-alarm:${state}`,
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

    const webhookEvent = lookup.event;

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

    // `error` is cleared for the same reason as the other webhook routes: a
    // redelivery re-drives any row that isn't `processed`, so this one may
    // still carry the message from a previous failed attempt.
    await webhookRepo.update(webhookEvent.id, {
        status: 'processed',
        error: null,
    });

    return NextResponse.json({ received: true });
}

/**
 * A valid signature proves that *an* SNS topic sent the message, not that ours
 * did — any AWS account can subscribe this public endpoint to its own topic.
 * `TopicArn` is part of the signed string for every message type, so once the
 * signature checks out, comparing it is spoof-proof (#319).
 *
 * Gates both message types, not just `SubscriptionConfirmation`: a foreign
 * subscription confirmed before this check shipped stays confirmed, so only
 * the Notification check actually closes it. Fails closed when the expected
 * ARN is unset.
 *
 * Rejections are a log line and nothing else — a `webhook_events` row or an
 * alert per rejected message would hand a foreign topic back the same spam
 * channel this check exists to close.
 */
function isOpsAlertsTopic(body: Record<string, unknown>): boolean {
    const expectedTopicArn = env.SNS_OPS_ALERTS_TOPIC_ARN;
    const logContext = { topicArn: body.TopicArn, type: body.Type };

    if (!expectedTopicArn) {
        // Our misconfiguration, not an attack: every real alarm is being
        // dropped too, hence louder than the foreign-topic warn below.
        log.error(
            logContext,
            'SNS_OPS_ALERTS_TOPIC_ARN is unset; rejecting SNS message'
        );
        return false;
    }

    if (body.TopicArn !== expectedTopicArn) {
        log.warn(logContext, 'Rejected SNS message from unexpected topic');
        return false;
    }

    return true;
}

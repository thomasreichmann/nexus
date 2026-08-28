import MessageValidator from 'sns-validator';
import { alerts } from '@/lib/alerts';
import { toErrorMessage } from '@/lib/errors';
import { logger } from '@/server/lib/logger';
import type { SnsSubscriptionConfirmation } from './types';

const validator = new MessageValidator();

const log = logger.child({ lib: 'sns' });

/**
 * Verify an SNS message signature.
 * Validates the certificate chain against *.amazonaws.com.
 */
export async function verifySnsMessage(
    body: Record<string, unknown>
): Promise<void> {
    return new Promise((resolve, reject) => {
        validator.validate(body, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Confirm an SNS subscription by fetching its `SubscribeURL`.
 *
 * Lives here rather than in a route because it is identical for every SNS
 * endpoint and the failure mode is severe: an unconfirmed subscription
 * delivers nothing at all, silently. Hardened in #331, and kept when the S3
 * restore rail — the route this was written for — was removed in #416.
 */
export async function confirmSnsSubscription(
    message: SnsSubscriptionConfirmation
): Promise<void> {
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
        // Louder than a log line: until someone re-triggers confirmation,
        // every message on this topic is lost (#331).
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
}

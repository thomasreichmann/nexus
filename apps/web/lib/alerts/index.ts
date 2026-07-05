import { send } from './send';

/**
 * Operational alerting for failure points, warnings, and checks — importable
 * from API routes, `server/services/`, and `scripts/`. Delivery follows a
 * warn-and-swallow contract: `send` never throws (await it freely — failures
 * and timeouts are logged, not raised), and with zero configured transports
 * it's a no-op.
 *
 * v1 ships a single transport (Discord webhook via
 * `DISCORD_ALERT_WEBHOOK_URL`); future channels implement `AlertTransport`
 * with no call-site changes.
 *
 * @example
 * ```typescript
 * import { alerts } from '@/lib/alerts';
 *
 * await alerts.send({
 *     severity: 'error',
 *     title: 'Stripe webhook processing failed',
 *     message: 'Handler threw; the event row is marked failed.',
 *     context: { source: 'stripe', eventType: 'invoice.paid', error: '…' },
 * });
 * ```
 */
export const alerts = {
    send,
} as const;

export type {
    Alert,
    AlertSeverity,
    AlertTransport,
    DeliverableAlert,
} from './types';

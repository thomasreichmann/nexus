import { resolveRuntimeEnvironment } from '@/lib/env/runtime';
import { logger } from '@/server/lib/logger';
import { discordTransport } from './discord';
import type { Alert, AlertTransport, DeliverableAlert } from './types';

const log = logger.child({ service: 'alerts' });

const transports: AlertTransport[] = [discordTransport];

/**
 * Dispatches an alert to the given transports. Exported for tests —
 * production callers go through `alerts.send`, which uses the configured
 * transport list.
 */
export async function dispatch(
    alert: Alert,
    targets: AlertTransport[]
): Promise<void> {
    // Alerting must never fail the work that triggered it — same
    // warn-and-swallow contract as server/services/email.ts.
    try {
        // One shared channel across environments until the multi-env split
        // (#292) settles, so every alert carries where it came from.
        const deliverable: DeliverableAlert = {
            ...alert,
            environment: resolveRuntimeEnvironment(),
        };

        await Promise.all(
            targets.map(async (transport) => {
                if (!transport.isConfigured()) {
                    log.debug(
                        { transport: transport.name },
                        'Alert transport not configured, skipping'
                    );
                    return;
                }
                try {
                    await transport.send(deliverable);
                } catch (err) {
                    log.warn(
                        { transport: transport.name, err, title: alert.title },
                        'Failed to deliver alert'
                    );
                }
            })
        );
    } catch (err) {
        log.warn({ err, title: alert.title }, 'Alert dispatch failed');
    }
}

export async function send(alert: Alert): Promise<void> {
    await dispatch(alert, transports);
}

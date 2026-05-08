'use client';

import pino, { type LogEvent } from 'pino';

type ClientLogContext = {
    userId?: string;
    page?: string;
};

let context: ClientLogContext = {};

export function setClientLogContext(next: ClientLogContext): void {
    context = { ...context, ...next };
}

// Exported so tests can drive it directly: pino's `browser` config is ignored
// when this module is imported under Node (vitest), so we can't observe
// transmit through the `log` instance.
export function transmitToDevServer(_level: string, logEvent: LogEvent): void {
    if (process.env.NODE_ENV !== 'development') return;

    const enriched: LogEvent = {
        ...logEvent,
        bindings: [...logEvent.bindings, { ...context }],
    };

    fetch('/api/dev-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enriched),
    }).catch(() => {
        // Silently ignore errors - we don't want logging to break the app
    });
}

export const log = pino({
    browser: {
        asObject: true,
        transmit: { send: transmitToDevServer },
    },
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
    enabled: typeof window !== 'undefined',
});

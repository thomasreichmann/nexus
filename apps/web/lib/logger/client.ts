'use client';

import pino, { type LogEvent } from 'pino';

function sendToDevServer(_level: string, logEvent: LogEvent): void {
    if (process.env.NODE_ENV !== 'development') return;

    fetch('/api/dev-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEvent),
    }).catch(() => {
        // Silently ignore errors - we don't want logging to break the app
    });
}

export const log = pino({
    browser: {
        asObject: true,
        transmit: {
            send: sendToDevServer,
        },
    },
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
});

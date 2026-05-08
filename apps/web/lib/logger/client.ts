'use client';

import pino, { type LogEvent } from 'pino';

type ClientLogContext = {
    userId?: string;
    page?: string;
};

let context: ClientLogContext = {};

// Singleton + setter rather than pino's `child()` because the four call
// sites (cache.onError, error.tsx, global-error.tsx, window listeners)
// span render and effect boundaries and can't all hold a React-bound
// logger reference reaching session/pathname hooks.
export function setClientLogContext(next: ClientLogContext): void {
    const merged: ClientLogContext = { ...context };
    for (const key of Object.keys(next) as (keyof ClientLogContext)[]) {
        const value = next[key];
        if (value === undefined) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }
    context = merged;
}

export function resetClientLogContext(): void {
    context = {};
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
    }).catch(() => {});
}

export const log = pino({
    browser: {
        asObject: true,
        transmit: { send: transmitToDevServer },
    },
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
});

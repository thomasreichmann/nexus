'use client';

import pino, { type LogEvent } from 'pino';

type ClientLogContext = {
    userId?: string;
    page?: string;
};

let context: ClientLogContext = {};

// Singleton + setter rather than pino `child()` so non-React call sites
// (cache hooks, window listeners) can read context without holding a
// React-bound logger reference.
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

// Exported for tests: pino's `browser` config is ignored when this
// module is imported under Node, so transmit can't be driven via `log`.
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
    // Silences pino's Node transport (loaded under SSR/vitest because
    // pino's `browser` redirect only applies in the browser bundle).
    // Does NOT gate browser transmit — that's handled by the `NODE_ENV`
    // check inside `transmitToDevServer`.
    enabled: typeof window !== 'undefined',
});

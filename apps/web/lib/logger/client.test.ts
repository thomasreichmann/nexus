import type { LogEvent } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    resetClientLogContext,
    setClientLogContext,
    transmitToDevServer,
} from './client';

function makeLogEvent(overrides: Partial<LogEvent> = {}): LogEvent {
    return {
        ts: Date.now(),
        messages: ['boom'],
        bindings: [],
        level: { label: 'error', value: 50 },
        ...overrides,
    };
}

function getMergedBindings(callIndex = 0): Record<string, unknown> {
    const body = JSON.parse(String(fetchMock.mock.calls[callIndex]![1]?.body));
    return body.bindings.reduce(
        (acc: Record<string, unknown>, b: Record<string, unknown>) => ({
            ...acc,
            ...b,
        }),
        {}
    );
}

const fetchMock = vi.fn(() => Promise.resolve(new Response()));

describe('client logger', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('NODE_ENV', 'development');
        fetchMock.mockClear();
        resetClientLogContext();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    describe('transmitToDevServer', () => {
        it('POSTs the log event to /api/dev-log in development', () => {
            transmitToDevServer('error', makeLogEvent());

            expect(fetchMock).toHaveBeenCalledOnce();
            const [url, init] = fetchMock.mock.calls[0]!;
            expect(url).toBe('/api/dev-log');
            expect(init?.method).toBe('POST');
            expect(init?.headers).toMatchObject({
                'Content-Type': 'application/json',
            });
        });

        it('does not POST in production', () => {
            vi.stubEnv('NODE_ENV', 'production');

            transmitToDevServer('error', makeLogEvent());

            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('appends setClientLogContext bindings to the transmitted event', () => {
            setClientLogContext({ userId: 'user-123', page: '/dashboard' });

            transmitToDevServer(
                'error',
                makeLogEvent({ bindings: [{ a: 1 }] })
            );

            const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
            expect(body.bindings).toEqual([
                { a: 1 },
                { userId: 'user-123', page: '/dashboard' },
            ]);
        });

        it('swallows fetch rejections so logging never throws', () => {
            fetchMock.mockRejectedValueOnce(new Error('network down'));

            expect(() =>
                transmitToDevServer('error', makeLogEvent())
            ).not.toThrow();
        });
    });

    describe('setClientLogContext', () => {
        it('updates context across calls (latest wins per key)', () => {
            setClientLogContext({ userId: 'user-1', page: '/a' });
            setClientLogContext({ page: '/b' });

            transmitToDevServer('error', makeLogEvent());

            expect(getMergedBindings()).toMatchObject({
                userId: 'user-1',
                page: '/b',
            });
        });

        it('deletes a key when set to undefined (sign-out flow)', () => {
            setClientLogContext({ userId: 'user-1', page: '/a' });
            setClientLogContext({ userId: undefined });

            transmitToDevServer('error', makeLogEvent());

            const merged = getMergedBindings();
            expect(merged).not.toHaveProperty('userId');
            expect(merged).toMatchObject({ page: '/a' });
        });
    });

    describe('resetClientLogContext', () => {
        it('clears all bindings', () => {
            setClientLogContext({ userId: 'user-1', page: '/a' });
            resetClientLogContext();

            transmitToDevServer('error', makeLogEvent());

            const merged = getMergedBindings();
            expect(merged).not.toHaveProperty('userId');
            expect(merged).not.toHaveProperty('page');
        });
    });
});

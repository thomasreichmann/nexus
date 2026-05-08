import type { LogEvent } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setClientLogContext, transmitToDevServer } from './client';

function makeLogEvent(overrides: Partial<LogEvent> = {}): LogEvent {
    return {
        ts: Date.now(),
        messages: ['boom'],
        bindings: [],
        level: { label: 'error', value: 50 },
        ...overrides,
    };
}

const fetchMock = vi.fn(() => Promise.resolve(new Response()));

describe('transmitToDevServer', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('NODE_ENV', 'development');
        fetchMock.mockClear();
        // Reset context between tests
        setClientLogContext({ userId: undefined, page: undefined });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

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

        transmitToDevServer('error', makeLogEvent({ bindings: [{ a: 1 }] }));

        const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
        expect(body.bindings).toEqual([
            { a: 1 },
            { userId: 'user-123', page: '/dashboard' },
        ]);
    });

    it('updates context across calls (latest wins per key)', () => {
        setClientLogContext({ userId: 'user-1', page: '/a' });
        setClientLogContext({ page: '/b' });

        transmitToDevServer('error', makeLogEvent());

        const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
        const merged = body.bindings.reduce(
            (acc: Record<string, unknown>, b: Record<string, unknown>) => ({
                ...acc,
                ...b,
            }),
            {}
        );
        expect(merged).toMatchObject({ userId: 'user-1', page: '/b' });
    });
});

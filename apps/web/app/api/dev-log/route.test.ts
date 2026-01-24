import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { LogEvent } from 'pino';

const mockChild = vi.hoisted(() => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
}));

// Mock the logger module
vi.mock('@/server/lib/logger', () => {
    return {
        logger: {
            child: vi.fn(() => mockChild),
        },
    };
});

// Import after mock setup
import { POST } from './route';

function createLogEvent(overrides: Partial<LogEvent> = {}): LogEvent {
    return {
        ts: Date.now(),
        messages: ['test message'],
        bindings: [],
        level: { label: 'info', value: 30 },
        ...overrides,
    };
}

function createRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/dev-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/dev-log', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('NODE_ENV', 'development');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns 404 in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');

        const response = await POST(createRequest(createLogEvent()));

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe('Not found');
    });

    it('returns 200 for valid log event', async () => {
        const response = await POST(createRequest(createLogEvent()));

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.ok).toBe(true);
    });

    it('returns 400 for invalid JSON', async () => {
        const request = new NextRequest('http://localhost/api/dev-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not valid json',
        });

        const response = await POST(request);

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Invalid log event');
    });

    it('logs with correct level from log event', async () => {
        // Test different log levels
        const levels = [
            { value: 10, label: 'trace', method: 'trace' },
            { value: 20, label: 'debug', method: 'debug' },
            { value: 30, label: 'info', method: 'info' },
            { value: 40, label: 'warn', method: 'warn' },
            { value: 50, label: 'error', method: 'error' },
            { value: 60, label: 'fatal', method: 'fatal' },
        ] as const;

        for (const { value, label, method } of levels) {
            vi.clearAllMocks();

            const logEvent = createLogEvent({
                level: { label, value },
                messages: [`${method} test`],
            });

            await POST(createRequest(logEvent));

            expect(mockChild[method]).toHaveBeenCalled();
        }
    });

    it('merges bindings into log call', async () => {
        const logEvent = createLogEvent({
            bindings: [{ userId: '123' }, { requestId: 'abc' }],
            messages: ['user action'],
        });

        await POST(createRequest(logEvent));

        expect(mockChild.info).toHaveBeenCalledWith(
            { userId: '123', requestId: 'abc' },
            'user action'
        );
    });

    it('handles object as first message', async () => {
        const logEvent = createLogEvent({
            bindings: [{ source: 'app' }],
            messages: [{ action: 'click', target: 'button' }, 'user clicked'],
        });

        await POST(createRequest(logEvent));

        expect(mockChild.info).toHaveBeenCalledWith(
            { source: 'app', action: 'click', target: 'button' },
            'user clicked'
        );
    });

    it('defaults to info level for unknown level values', async () => {
        const logEvent = createLogEvent({
            level: { label: 'unknown', value: 999 },
            messages: ['unknown level'],
        });

        await POST(createRequest(logEvent));

        expect(mockChild.info).toHaveBeenCalled();
    });
});

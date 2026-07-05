import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { AlertTransport } from './types';

const hoisted = await vi.hoisted(async () => {
    const { createMockLogger } = await import('@/server/lib/logger/testing');
    return {
        logger: createMockLogger(),
        env: { DISCORD_ALERT_WEBHOOK_URL: undefined as string | undefined },
    };
});

vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));
vi.mock('@/lib/env', () => ({ env: hoisted.env }));

const { dispatch, send } = await import('./send');

const alert = {
    severity: 'error',
    title: 'something broke',
    message: 'details',
} as const;

function makeTransport(
    overrides: Partial<AlertTransport> = {}
): AlertTransport {
    return {
        name: 'mock',
        isConfigured: () => true,
        send: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('delivers to every configured transport with the environment attached', async () => {
        vi.stubEnv('VERCEL_ENV', 'production');
        const first = makeTransport({ name: 'first' });
        const second = makeTransport({ name: 'second' });

        await dispatch(alert, [first, second]);

        for (const transport of [first, second]) {
            expect(transport.send).toHaveBeenCalledExactlyOnceWith({
                ...alert,
                environment: 'production',
            });
        }
    });

    it('falls back to NODE_ENV when VERCEL_ENV is unset', async () => {
        const transport = makeTransport();

        await dispatch(alert, [transport]);

        expect(transport.send).toHaveBeenCalledWith(
            expect.objectContaining({ environment: 'test' })
        );
    });

    it('skips unconfigured transports with a debug log', async () => {
        const unconfigured = makeTransport({
            name: 'unconfigured',
            isConfigured: () => false,
        });
        const configured = makeTransport({ name: 'configured' });

        await dispatch(alert, [unconfigured, configured]);

        expect(unconfigured.send).not.toHaveBeenCalled();
        expect(configured.send).toHaveBeenCalledOnce();
        expect(hoisted.logger.debug).toHaveBeenCalledWith(
            { transport: 'unconfigured' },
            'Alert transport not configured, skipping'
        );
    });

    it('isolates a failing transport: others still deliver, nothing throws', async () => {
        const failing = makeTransport({
            name: 'failing',
            send: vi.fn().mockRejectedValue(new Error('boom')),
        });
        const healthy = makeTransport({ name: 'healthy' });

        await expect(
            dispatch(alert, [failing, healthy])
        ).resolves.toBeUndefined();

        expect(healthy.send).toHaveBeenCalledOnce();
        expect(hoisted.logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ transport: 'failing' }),
            'Failed to deliver alert'
        );
    });

    it('is a no-op with zero transports', async () => {
        await expect(dispatch(alert, [])).resolves.toBeUndefined();

        expect(hoisted.logger.warn).not.toHaveBeenCalled();
    });
});

describe('send', () => {
    it('no-ops (and never throws) when no transport is configured', async () => {
        // The real transport list holds only discord, whose env var is unset
        // in this test file's env mock.
        await expect(send(alert)).resolves.toBeUndefined();

        expect(hoisted.logger.debug).toHaveBeenCalledWith(
            { transport: 'discord' },
            'Alert transport not configured, skipping'
        );
        expect(hoisted.logger.warn).not.toHaveBeenCalled();
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PostHogEvent } from './events';
import { createServerAnalytics, isServerAnalyticsEnabled } from './server';

import type { ServerAnalyticsOptions } from './server';

const hoisted = vi.hoisted(() => ({ capture: vi.fn(), construct: vi.fn() }));

vi.mock('posthog-node', () => ({
    // A class, not vi.fn(() => …): the module under test calls `new PostHog`,
    // and an arrow-function mock implementation isn't constructible.
    PostHog: class {
        capture = hoisted.capture;
        constructor(key: string, options: Record<string, unknown>) {
            hoisted.construct(key, options);
        }
    },
}));

const enabledOptions: ServerAnalyticsOptions = {
    enabled: true,
    key: 'phc_test',
    host: 'https://us.i.posthog.com',
    environment: 'production',
};

beforeEach(() => {
    hoisted.capture.mockReset();
    hoisted.construct.mockClear();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('isServerAnalyticsEnabled', () => {
    it('is on only for the exact opt-in value', () => {
        vi.stubEnv('ANALYTICS_ENABLED', 'true');
        expect(isServerAnalyticsEnabled()).toBe(true);
    });

    it.each(['false', '1', 'TRUE', ''])('is off for %o', (value) => {
        vi.stubEnv('ANALYTICS_ENABLED', value);
        expect(isServerAnalyticsEnabled()).toBe(false);
    });

    it('is off when unset — local dev, CI, and e2e builds never opt in', () => {
        vi.stubEnv('ANALYTICS_ENABLED', undefined);
        expect(isServerAnalyticsEnabled()).toBe(false);
    });
});

describe('createServerAnalytics', () => {
    it('never constructs a client when disabled', () => {
        const analytics = createServerAnalytics({
            ...enabledOptions,
            enabled: false,
        });
        analytics.captureEvent('user-1', PostHogEvent.RetrievalReady);

        expect(hoisted.construct).not.toHaveBeenCalled();
        expect(hoisted.capture).not.toHaveBeenCalled();
    });

    it('never constructs a client without a key', () => {
        const analytics = createServerAnalytics({
            ...enabledOptions,
            key: undefined,
        });
        analytics.captureEvent('user-1', PostHogEvent.RetrievalReady);

        expect(hoisted.construct).not.toHaveBeenCalled();
        expect(hoisted.capture).not.toHaveBeenCalled();
    });

    it('falls back to the shared env gate when `enabled` is omitted', () => {
        vi.stubEnv('ANALYTICS_ENABLED', 'true');
        const { enabled: _enabled, ...withoutEnabled } = enabledOptions;

        createServerAnalytics(withoutEnabled).captureEvent(
            'user-1',
            PostHogEvent.RetrievalReady
        );

        expect(hoisted.construct).toHaveBeenCalledTimes(1);
    });

    it('stays off when `enabled` is omitted and the env gate is unset', () => {
        vi.stubEnv('ANALYTICS_ENABLED', undefined);
        const { enabled: _enabled, ...withoutEnabled } = enabledOptions;

        createServerAnalytics(withoutEnabled).captureEvent(
            'user-1',
            PostHogEvent.RetrievalReady
        );

        expect(hoisted.construct).not.toHaveBeenCalled();
    });

    it('defers construction until the first capture', () => {
        createServerAnalytics(enabledOptions);
        expect(hoisted.construct).not.toHaveBeenCalled();
    });

    it('constructs one client and reuses it across captures', () => {
        const analytics = createServerAnalytics(enabledOptions);
        analytics.captureEvent('user-1', PostHogEvent.RetrievalReady);
        analytics.captureEvent('user-1', PostHogEvent.FileDownloaded);

        expect(hoisted.construct).toHaveBeenCalledTimes(1);
        expect(hoisted.construct).toHaveBeenCalledWith('phc_test', {
            host: 'https://us.i.posthog.com',
            waitUntil: undefined,
        });
    });

    it('stamps every event with the caller-resolved environment', () => {
        const analytics = createServerAnalytics(enabledOptions);
        analytics.captureEvent('user-1', PostHogEvent.RetrievalReady, {
            fileId: 'file-1',
        });

        expect(hoisted.capture).toHaveBeenCalledWith({
            distinctId: 'user-1',
            event: 'retrieval_ready',
            properties: { fileId: 'file-1', environment: 'production' },
        });
    });

    it('does not let a caller shadow the environment property', () => {
        const analytics = createServerAnalytics(enabledOptions);
        analytics.captureEvent('user-1', PostHogEvent.RetrievalReady, {
            environment: 'spoofed',
        });

        expect(hoisted.capture).toHaveBeenCalledWith(
            expect.objectContaining({
                properties: { environment: 'production' },
            })
        );
    });

    it('swallows a capture failure — analytics never fails real work', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        hoisted.capture.mockImplementation(() => {
            throw new Error('posthog is down');
        });

        const analytics = createServerAnalytics(enabledOptions);
        expect(() =>
            analytics.captureEvent('user-1', PostHogEvent.RetrievalReady)
        ).not.toThrow();
        expect(warn).toHaveBeenCalled();

        warn.mockRestore();
    });
});

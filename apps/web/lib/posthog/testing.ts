import { vi, type Mock } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

export interface MockPostHogClient {
    initAnalytics: AnyMock;
    isAnalyticsEnabled: AnyMock;
    identifyUser: AnyMock;
    resetAnalytics: AnyMock;
    captureEvent: AnyMock;
    showFeedbackSurvey: AnyMock;
}

export interface MockPostHogServer {
    captureServerEvent: AnyMock;
}

/**
 * Vitest stub for `@/lib/posthog/client`. Wire it through `vi.hoisted` with a
 * dynamic import (same pattern as `@/lib/sentry/testing`):
 *
 * ```ts
 * const hoisted = await vi.hoisted(async () => {
 *     const { createMockPostHogClient } = await import('@/lib/posthog/testing');
 *     return { posthog: createMockPostHogClient() };
 * });
 * vi.mock('@/lib/posthog/client', () => hoisted.posthog);
 * ```
 *
 * Worth mocking even though the real module already no-ops when analytics is
 * disabled: without it a test proves nothing, because the assertion and the
 * unconfigured no-op are indistinguishable.
 */
export function createMockPostHogClient(): MockPostHogClient {
    return {
        initAnalytics: vi.fn(),
        isAnalyticsEnabled: vi.fn(() => false),
        identifyUser: vi.fn(),
        resetAnalytics: vi.fn(),
        captureEvent: vi.fn(),
        showFeedbackSurvey: vi.fn(),
    };
}

/** Vitest stub for `@/lib/posthog/server`. Same wiring as the client stub. */
export function createMockPostHogServer(): MockPostHogServer {
    return { captureServerEvent: vi.fn() };
}

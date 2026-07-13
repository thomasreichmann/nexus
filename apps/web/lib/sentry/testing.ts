import { vi, type Mock } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

export interface MockSentry {
    captureException: AnyMock;
}

/**
 * Vitest stub for `@sentry/nextjs`. Wire it through `vi.hoisted` with a
 * dynamic import (same pattern as `@/server/lib/logger/testing`):
 *
 * ```ts
 * const hoisted = await vi.hoisted(async () => {
 *     const { createMockSentry } = await import('@/lib/sentry/testing');
 *     return { sentry: createMockSentry() };
 * });
 * vi.mock('@sentry/nextjs', () => hoisted.sentry);
 * ```
 */
export function createMockSentry(): MockSentry {
    return { captureException: vi.fn() };
}

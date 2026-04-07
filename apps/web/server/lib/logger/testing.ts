import { vi, type Mock } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

export interface MockLogger {
    trace: AnyMock;
    debug: AnyMock;
    info: AnyMock;
    warn: AnyMock;
    error: AnyMock;
    fatal: AnyMock;
    /** Returns the same logger instance so chained `.child()` calls work transparently. */
    child: AnyMock;
}

/**
 * Vitest stub for `@/server/lib/logger`'s `logger` export. `child(...)` returns
 * the same instance so production code that does `logger.child({...}).info(...)`
 * routes through the same spies.
 *
 * Wire it through `vi.hoisted` with a dynamic import — `vi.hoisted` runs before
 * static imports, so this file must be loaded asynchronously inside the block:
 *
 * ```ts
 * const hoisted = await vi.hoisted(async () => {
 *     const { createMockLogger } = await import('@/server/lib/logger/testing');
 *     return { logger: createMockLogger() };
 * });
 * vi.mock('@/server/lib/logger', () => ({ logger: hoisted.logger }));
 * ```
 */
export function createMockLogger(): MockLogger {
    const logger: MockLogger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return logger;
}

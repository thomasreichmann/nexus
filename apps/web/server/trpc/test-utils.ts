import type { RequestLogger, LoggingContext } from './middleware/logging';
import { createMockDb, createUserFixture, type User } from '@nexus/db';
import type { Context, LoggedContext } from './init';

/**
 * Options for creating a mock tRPC context
 */
export interface MockContextOptions {
    /**
     * Whether to include an authenticated session
     * @default true
     */
    authenticated?: boolean;
    /**
     * Partial user data to override defaults
     * Only used when authenticated is true
     */
    user?: Partial<User>;
}

/**
 * Mock session matching BetterAuth session structure
 */
export interface MockSession {
    user: User;
    session: {
        id: string;
        token: string;
        expiresAt: Date;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
        ipAddress?: string | null;
        userAgent?: string | null;
    };
}

/**
 * Return type of createMockContext for use in tests
 */
export interface MockContext {
    ctx: LoggedContext;
    mocks: ReturnType<typeof createMockDb>['mocks'];
    session: MockSession | null;
}

/**
 * Creates a no-op request logger for testing
 * All methods are functional but don't emit logs
 */
function createMockRequestLogger(): RequestLogger {
    return {
        setField: () => {},
        timed: async <T>(_label: string, fn: () => T | Promise<T>) => fn(),
        time: () => {},
        timeEnd: () => {},
    };
}

/**
 * Creates a mock tRPC context for unit testing protected procedures
 *
 * @example
 * ```typescript
 * import { createMockContext } from '@/server/trpc/test-utils';
 *
 * describe('myProcedure', () => {
 *   it('works with authenticated user', () => {
 *     const { ctx, mocks } = createMockContext();
 *     // ctx.session is populated with mock user
 *     // mocks contains database mock functions for assertions
 *   });
 *
 *   it('handles unauthenticated requests', () => {
 *     const { ctx } = createMockContext({ authenticated: false });
 *     // ctx.session is null
 *   });
 *
 *   it('uses custom user data', () => {
 *     const { ctx } = createMockContext({
 *       user: { id: 'custom-id', name: 'Custom User' }
 *     });
 *   });
 * });
 * ```
 */
export function createMockContext(
    options: MockContextOptions = {}
): MockContext {
    const { authenticated = true, user: userOverrides } = options;

    const { db, mocks } = createMockDb();
    const requestId = crypto.randomUUID();
    const log = createMockRequestLogger();

    let session: MockSession | null = null;

    if (authenticated) {
        const user = createUserFixture(userOverrides);
        const now = new Date();
        session = {
            user,
            session: {
                id: crypto.randomUUID(),
                token: crypto.randomUUID(),
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                userId: user.id,
                createdAt: now,
                updatedAt: now,
                ipAddress: null,
                userAgent: null,
            },
        };
    }

    const loggingContext: LoggingContext = {
        requestId,
        log,
    };

    const baseContext: Context = {
        db,
        session,
    };

    const ctx: LoggedContext = {
        ...baseContext,
        ...loggingContext,
    };

    return {
        ctx,
        mocks,
        session,
    };
}

import { vi, type Mock } from 'vitest';
import type { Connection } from '../connection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

interface QueryMock {
    findFirst: AnyMock;
    findMany: AnyMock;
}

function createQueryMock(): QueryMock {
    return { findFirst: vi.fn(), findMany: vi.fn() };
}

export function createMockDb() {
    // Default to [] so destructuring `const [row] = await ...returning()` doesn't
    // explode in tests that don't care about the returned row. Tests that need a
    // specific value override with `mocks.returning.mockResolvedValue([row])`.
    const returning: AnyMock = vi.fn().mockResolvedValue([]);
    const groupBy: AnyMock = vi.fn();
    const where: AnyMock = vi.fn(() => ({ returning, groupBy }));
    const set: AnyMock = vi.fn(() => ({ where }));
    const onConflictDoUpdate: AnyMock = vi.fn(() => ({ returning }));
    const values: AnyMock = vi.fn(() => ({ returning, onConflictDoUpdate }));
    const from: AnyMock = vi.fn(() => ({ where, groupBy }));
    const select: AnyMock = vi.fn(() => ({ from }));
    const insert: AnyMock = vi.fn(() => ({ values }));
    const update: AnyMock = vi.fn(() => ({ set }));
    const deleteFn: AnyMock = vi.fn(() => ({ where }));

    const files = createQueryMock();
    const backgroundJobs = createQueryMock();
    const retrievals = createQueryMock();
    const subscriptions = createQueryMock();
    const webhookEvents = createQueryMock();

    const db = {
        query: {
            files,
            backgroundJobs,
            retrievals,
            subscriptions,
            webhookEvents,
        },
        select,
        insert,
        update,
        delete: deleteFn,
        // Transaction passes itself as tx, callback can use same mock methods
        transaction: vi.fn((callback) => callback(db)),
    } as unknown as Connection;

    return {
        db,
        mocks: {
            // Insert/update/delete pipeline mocks
            select,
            from,
            where,
            insert,
            values,
            onConflictDoUpdate,
            update,
            set,
            delete: deleteFn,
            returning,
            groupBy,
            // Per-table query mocks (db.query.<table>.findFirst/findMany)
            files,
            backgroundJobs,
            retrievals,
            subscriptions,
            webhookEvents,
        },
    };
}

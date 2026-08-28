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
    const orderBy: AnyMock = vi.fn();
    const where: AnyMock = vi.fn(() => ({ returning, groupBy }));
    const set: AnyMock = vi.fn(() => ({ where }));
    const onConflictDoUpdate: AnyMock = vi.fn(() => ({ returning }));
    const onConflictDoNothing: AnyMock = vi.fn(() => ({ returning }));
    const values: AnyMock = vi.fn(() => ({
        returning,
        onConflictDoUpdate,
        onConflictDoNothing,
    }));
    // leftJoin has its own `where` so the `.where().orderBy()`/`.where()
    // .groupBy()` terminals here don't collide with the awaitable `where`
    // used by simpler chains. leftJoin returns itself so chains may stack
    // any number of joins.
    // Its result is a promise carrying those two terminals as properties, so
    // one shape covers both a chain that ends at the WHERE (an ungrouped
    // aggregate) and one that continues. Tests override `mocks.leftJoinRows`
    // for the first, `mocks.orderBy`/`mocks.groupBy` for the rest.
    // Typed rather than AnyMock because this one is called here, not just
    // handed to the caller: `Mock<any>` isn't callable.
    const leftJoinRows: Mock<() => Promise<unknown[]>> = vi.fn(
        async () => [] as unknown[]
    );
    const leftJoinWhere: AnyMock = vi.fn(() =>
        Object.assign(leftJoinRows(), { orderBy, groupBy })
    );
    const leftJoin: AnyMock = vi.fn(() => ({
        leftJoin,
        where: leftJoinWhere,
        orderBy,
    }));
    // innerJoin chains (the retrieval-with-file reads) end one step later
    // than leftJoin ones, at `.limit()`. They get their own terminals so a
    // `mocks.orderBy.mockResolvedValue(...)` for a leftJoin chain can't be
    // consumed by an innerJoin one. To stop a chain at `.orderBy()` instead,
    // override `mocks.innerJoinOrderBy` directly.
    const limit: AnyMock = vi.fn().mockResolvedValue([]);
    const innerJoinOrderBy: AnyMock = vi.fn(() => ({ limit }));
    const innerJoinWhere: AnyMock = vi.fn(() => ({
        orderBy: innerJoinOrderBy,
        groupBy,
    }));
    const innerJoin: AnyMock = vi.fn(() => ({
        innerJoin,
        where: innerJoinWhere,
        orderBy: innerJoinOrderBy,
    }));
    const from: AnyMock = vi.fn(() => ({
        where,
        groupBy,
        leftJoin,
        innerJoin,
    }));
    const select: AnyMock = vi.fn(() => ({ from }));
    const insert: AnyMock = vi.fn(() => ({ values }));
    const update: AnyMock = vi.fn(() => ({ set }));
    const deleteFn: AnyMock = vi.fn(() => ({ where }));

    const files = createQueryMock();
    const invites = createQueryMock();
    const backgroundJobs = createQueryMock();
    const retrievals = createQueryMock();
    const retrievalRequests = createQueryMock();
    const retrievalRequestItems = createQueryMock();
    const retrievalArtifacts = createQueryMock();
    const storageUsage = createQueryMock();
    const subscriptions = createQueryMock();
    const uploadBatches = createQueryMock();
    const webhookEvents = createQueryMock();
    const user = createQueryMock();

    /**
     * How many INSERTs targeted one table. A bare `mocks.insert` call count
     * says nothing once a single code path writes to several tables, and the
     * drizzle table is the first argument the mock records.
     */
    function countInsertsInto(table: unknown): number {
        return insert.mock.calls.filter(([target]) => target === table).length;
    }

    const db = {
        query: {
            files,
            invites,
            backgroundJobs,
            retrievals,
            retrievalRequests,
            retrievalRequestItems,
            retrievalArtifacts,
            storageUsage,
            subscriptions,
            uploadBatches,
            webhookEvents,
            user,
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
            leftJoin,
            leftJoinWhere,
            leftJoinRows,
            innerJoin,
            innerJoinWhere,
            innerJoinOrderBy,
            limit,
            where,
            insert,
            values,
            onConflictDoUpdate,
            onConflictDoNothing,
            update,
            set,
            delete: deleteFn,
            returning,
            groupBy,
            orderBy,
            countInsertsInto,
            // Per-table query mocks (db.query.<table>.findFirst/findMany)
            files,
            invites,
            backgroundJobs,
            retrievals,
            retrievalRequests,
            retrievalRequestItems,
            retrievalArtifacts,
            storageUsage,
            subscriptions,
            uploadBatches,
            webhookEvents,
            user,
        },
    };
}

export type MockDb = ReturnType<typeof createMockDb>['db'];
export type MockDbMocks = ReturnType<typeof createMockDb>['mocks'];

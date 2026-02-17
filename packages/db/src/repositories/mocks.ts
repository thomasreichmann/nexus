import { vi, type Mock } from 'vitest';
import type { DB } from '../connection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

export function createMockDb() {
    const findFirst: AnyMock = vi.fn();
    const findMany: AnyMock = vi.fn();
    const returning: AnyMock = vi.fn();
    const groupBy: AnyMock = vi.fn();
    const where: AnyMock = vi.fn(() => ({ returning, groupBy }));
    const set: AnyMock = vi.fn(() => ({ where }));
    const values: AnyMock = vi.fn(() => ({ returning }));
    const from: AnyMock = vi.fn(() => ({ where, groupBy }));
    const select: AnyMock = vi.fn(() => ({ from }));
    const insert: AnyMock = vi.fn(() => ({ values }));
    const update: AnyMock = vi.fn(() => ({ set }));
    const deleteFn: AnyMock = vi.fn(() => ({ where }));

    const db = {
        query: {
            files: { findFirst, findMany },
            backgroundJobs: { findFirst, findMany },
            retrievals: { findFirst, findMany },
            webhookEvents: { findFirst, findMany },
        },
        select,
        insert,
        update,
        delete: deleteFn,
        // Transaction passes itself as tx, callback can use same mock methods
        transaction: vi.fn((callback) => callback(db)),
    } as unknown as DB;

    return {
        db,
        mocks: {
            findFirst,
            findMany,
            select,
            from,
            where,
            insert,
            values,
            update,
            set,
            delete: deleteFn,
            returning,
            groupBy,
        },
    };
}

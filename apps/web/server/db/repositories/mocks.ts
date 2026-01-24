import { vi, type Mock } from 'vitest';
import type { DB } from '../index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<any>;

/**
 * Creates a mock DB instance for testing repository functions.
 * Returns both the mock db and individual mock functions for assertions.
 *
 * Note: Mocks are typed loosely to support flexible test scenarios
 * where the same mock (e.g., `where`) may return different types
 * depending on the query chain (select vs mutations).
 */
export function createMockDb() {
    // Relational query mocks
    const findFirst: AnyMock = vi.fn();
    const findMany: AnyMock = vi.fn();

    // Chainable builder mocks - typed loosely for flexibility
    const returning: AnyMock = vi.fn();
    const where: AnyMock = vi.fn(() => ({ returning }));
    const set: AnyMock = vi.fn(() => ({ where }));
    const values: AnyMock = vi.fn(() => ({ returning }));
    const from: AnyMock = vi.fn(() => ({ where }));

    // Top-level operation mocks
    const select: AnyMock = vi.fn(() => ({ from }));
    const insert: AnyMock = vi.fn(() => ({ values }));
    const update: AnyMock = vi.fn(() => ({ set }));
    const deleteFn: AnyMock = vi.fn(() => ({ where }));

    const db = {
        query: {
            files: {
                findFirst,
                findMany,
            },
        },
        select,
        insert,
        update,
        delete: deleteFn,
    } as unknown as DB;

    return {
        db,
        mocks: {
            // Relational queries
            findFirst,
            findMany,
            // Query builders
            select,
            from,
            where,
            // Mutations
            insert,
            values,
            update,
            set,
            delete: deleteFn,
            returning,
        },
    };
}

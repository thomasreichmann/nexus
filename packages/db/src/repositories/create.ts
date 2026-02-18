import type { DB } from '../connection';

type StripDb<F> = F extends (db: DB, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;

export function createRepository<
    T extends Record<string, (db: DB, ...args: never[]) => unknown>,
>(methods: T): (db: DB) => { [K in keyof T]: StripDb<T[K]> };
export function createRepository(
    methods: Record<string, (...args: unknown[]) => unknown>
) {
    return (db: unknown) => {
        const bound: Record<string, (...args: unknown[]) => unknown> = {};
        for (const key in methods) {
            bound[key] = (...args: unknown[]) => methods[key](db, ...args);
        }
        return bound;
    };
}

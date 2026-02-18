import type { DB } from '../connection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbFn = (db: DB, ...args: any[]) => any;

type StripDb<T extends DbFn> = T extends (db: DB, ...args: infer A) => infer R
    ? (...args: A) => R
    : never;

export function createRepository<T extends Record<string, DbFn>>(
    methods: T
): (db: DB) => { [K in keyof T]: StripDb<T[K]> } {
    return (db: DB) => {
        const bound = {} as Record<string, Function>;
        for (const key in methods) {
            bound[key] = (...args: unknown[]) => methods[key](db, ...args);
        }
        return bound as { [K in keyof T]: StripDb<T[K]> };
    };
}

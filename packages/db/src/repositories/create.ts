import type { DB } from '../connection';

/** Remove the first element from a tuple type. */
type Tail<T extends readonly unknown[]> = T extends [unknown, ...infer Rest]
    ? Rest
    : never;

/** Strip the first parameter (`db`) from a function signature. */
type OmitFirstParam<F extends (...args: never[]) => unknown> = (
    ...args: Tail<Parameters<F>>
) => ReturnType<F>;

export function createRepository<
    const T extends Record<string, (db: DB, ...args: never[]) => unknown>,
>(methods: T): (db: DB) => { [K in keyof T]: OmitFirstParam<T[K]> } {
    return (db) => {
        const bound = {} as { [K in keyof T]: OmitFirstParam<T[K]> };
        for (const key in methods) {
            const method = methods[key] as unknown as (
                ...args: unknown[]
            ) => unknown;
            (bound as Record<string, (...args: unknown[]) => unknown>)[key] = (
                ...args: unknown[]
            ) => method(db, ...args);
        }
        return bound;
    };
}

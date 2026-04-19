/**
 * Memoizes `factory` at the promise level so concurrent callers share
 * the in-flight promise — the factory fires at most once per lifetime.
 */
export function lazyAsync<T>(factory: () => Promise<T>): () => Promise<T> {
    let promise: Promise<T> | null = null;
    return () => {
        if (!promise) promise = factory();
        return promise;
    };
}

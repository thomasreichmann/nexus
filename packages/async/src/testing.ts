/**
 * Test helpers for driving async code by hand — the pair every concurrency
 * test needs: something to settle on demand, and a way to let the scheduler
 * catch up before asserting.
 */

export interface Deferred {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

/** A promise plus the handles to settle it from the test body. */
export function deferred(): Deferred {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Lets every already-scheduled microtask drain before the next assertion.
 * A macrotask hop, so it also clears promise chains queued by those microtasks.
 */
export function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

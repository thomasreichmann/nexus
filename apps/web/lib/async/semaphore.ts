/**
 * FIFO counting semaphore.
 *
 * Exists so several independent workers can share one connection budget: the
 * upload engines hand every browser→S3 PUT through here, so a wave of files
 * can't oversubscribe the browser's per-host socket cap no matter how the work
 * is split between single-part and multipart uploads.
 *
 * FIFO is load-bearing, not incidental. Permits are handed straight to the
 * longest-waiting caller rather than released back into a pool, so a late
 * arrival can't barge ahead of a queued one and starve it past a presigned
 * URL's TTL.
 */
export interface Semaphore {
    /** Runs `task` while holding one permit, releasing it however task settles. */
    run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSemaphore(permits: number): Semaphore {
    let available = permits;
    const waiting: Array<() => void> = [];

    // Only takes a permit when nobody is queued — otherwise it would barge past
    // waiters and break the FIFO guarantee above.
    const acquire = (): Promise<void> => {
        if (available > 0 && waiting.length === 0) {
            available--;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => waiting.push(resolve));
    };

    const release = (): void => {
        const next = waiting.shift();
        // Direct handoff: the permit never returns to the pool while someone
        // is queued for it.
        if (next) next();
        else available++;
    };

    return {
        async run<T>(task: () => Promise<T>): Promise<T> {
            await acquire();
            try {
                return await task();
            } finally {
                release();
            }
        },
    };
}

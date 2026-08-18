/**
 * Admission control for concurrent file uploads.
 *
 * The pool decides *how many* files move at once; the S3 connection semaphore
 * decides how many sockets they may use between them. Keeping the two separate
 * is what lets one big multipart file keep its full chunk concurrency while a
 * wave of small files still runs four-wide.
 *
 * Failure semantics are the inverse of the per-file chunk pool: a chunk failing
 * dooms its siblings because they are parts of one file, but a *file* failing
 * must leave the rest of the wave running. `run` is therefore expected to fold
 * its own failures into the row's status; anything that escapes is swallowed
 * here rather than taking the wave down.
 */

/** What a completed run tells the pool to do with the work still queued. */
export type FileRunOutcome =
    | 'continue'
    /** Nothing else can succeed either (quota) — drop the rest of the queue. */
    | 'halt';

export interface PoolItem {
    id: string;
    /** Admission weight: the pool caps the summed bytes it keeps in flight. */
    size: number;
}

export interface FilePoolOptions<T extends PoolItem> {
    maxConcurrent: number;
    /**
     * Ceiling on summed in-flight bytes. Bounds how far concurrent uploads can
     * overshoot the server's quota pre-check, which each of them passes against
     * the same committed baseline. Never blocks a lone file: one oversized file
     * still has to be uploadable.
     */
    maxInFlightBytes: number;
    run: (item: T) => Promise<FileRunOutcome>;
    /** Fires once when the pool goes idle, not once per file. */
    onDrained?: () => unknown;
    /**
     * Fires with the queued items a halt threw away, so their rows can be
     * put back into a state the user can act on — without this they'd sit
     * in whatever "waiting" state admission gave them, with nothing left
     * that will ever start them.
     */
    onDropped?: (items: T[]) => unknown;
}

export interface FilePool<T extends PoolItem> {
    /**
     * Queues items and returns the drain promise for the wave they joined.
     * Items already queued or in flight are ignored, so a double-click can't
     * upload the same row twice.
     */
    enqueue(items: T[]): Promise<void>;
}

export function createFilePool<T extends PoolItem>(
    options: FilePoolOptions<T>
): FilePool<T> {
    const queue: T[] = [];
    const running = new Map<string, Promise<void>>();
    let inFlightBytes = 0;
    let isHalted = false;
    let draining: Promise<void> | null = null;
    // Lets `enqueue` wake a drain that's parked waiting on in-flight files, so
    // work arriving mid-wave starts as soon as there's room rather than when
    // some unrelated file happens to finish.
    let pendingWake: { promise: Promise<void>; wake: () => void } | null = null;

    const workArrived = (): Promise<void> => {
        if (!pendingWake) {
            let wake!: () => void;
            const promise = new Promise<void>((resolve) => {
                wake = resolve;
            });
            pendingWake = { promise, wake };
        }
        return pendingWake.promise;
    };

    const start = (item: T): void => {
        inFlightBytes += item.size;
        const task = (async () => {
            try {
                if ((await options.run(item)) === 'halt') isHalted = true;
            } catch {
                // Defensive only: `run` owns its error reporting, and one file
                // blowing up must not abort the wave.
            }
        })().finally(() => {
            inFlightBytes -= item.size;
            running.delete(item.id);
        });
        running.set(item.id, task);
    };

    const canStart = (item: T): boolean =>
        running.size < options.maxConcurrent &&
        // An empty pool always admits, however big the file: a lone oversized
        // file still has to be uploadable, and serial uploads already tolerate
        // one file's worth of quota overshoot.
        (running.size === 0 ||
            inFlightBytes + item.size <= options.maxInFlightBytes);

    const drain = async (): Promise<void> => {
        for (;;) {
            // Consumed, not latched: the halt drops the work queued *at that
            // moment*. A row enqueued afterwards — a Retry click while the
            // in-flight siblings finish, a reconnect resume — is a fresh
            // decision by the user, and dropping it would strand the row in
            // `pending` with nothing left to start it.
            if (isHalted) {
                // Splice first, report second: `?.()` skips its arguments
                // when the callback is absent, so the splice must not live
                // inside the call.
                const droppedItems = queue.splice(0);
                if (droppedItems.length > 0) {
                    options.onDropped?.(droppedItems);
                }
                isHalted = false;
            }
            const next = queue[0];
            if (next && canStart(next)) {
                queue.shift();
                start(next);
                continue;
            }
            // Nothing admissible and nothing to wait on: the wave is done.
            if (running.size === 0) break;
            await Promise.race([...running.values(), workArrived()]);
        }
        draining = null;
        await options.onDrained?.();
    };

    return {
        enqueue(items: T[]): Promise<void> {
            for (const item of items) {
                if (running.has(item.id)) continue;
                if (queue.some((queued) => queued.id === item.id)) continue;
                queue.push(item);
            }
            // No work and no wave in progress: don't spin up a drain just to
            // fire `onDrained` at nothing.
            if (queue.length === 0 && running.size === 0) {
                return draining ?? Promise.resolve();
            }
            pendingWake?.wake();
            pendingWake = null;
            // Re-entrant by design: enqueueing mid-wave (a retry, a reconnect)
            // joins the live drain instead of starting a second pool.
            draining ??= drain();
            return draining;
        },
    };
}

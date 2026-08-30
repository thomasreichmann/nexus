import { describe, expect, it, vi } from 'vitest';
import { flushMicrotasks } from '@nexus/async/testing';
import { createFilePool, type FileRunOutcome, type PoolItem } from './filePool';

const GiB = 1024 ** 3;

/** Hands the test body control over when each item's run finishes. */
function createControllableRunner() {
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    let running = 0;
    let peak = 0;
    const outcomes = new Map<string, FileRunOutcome>();
    const failures = new Set<string>();

    const run = (item: PoolItem): Promise<FileRunOutcome> => {
        started.push(item.id);
        running++;
        peak = Math.max(peak, running);
        return new Promise<FileRunOutcome>((resolve, reject) => {
            gates.set(item.id, () => {
                running--;
                if (failures.has(item.id))
                    reject(new Error(`${item.id} blew up`));
                else resolve(outcomes.get(item.id) ?? 'continue');
            });
        });
    };

    return {
        run,
        started,
        outcomes,
        failures,
        get peak() {
            return peak;
        },
        get running() {
            return running;
        },
        finish(id: string) {
            const gate = gates.get(id);
            if (!gate) throw new Error(`${id} never started`);
            gate();
            return flushMicrotasks();
        },
    };
}

const makeItems = (count: number, size = 1): PoolItem[] =>
    Array.from({ length: count }, (_, i) => ({ id: `f${i}`, size }));

describe('createFilePool', () => {
    it('keeps at most maxConcurrent files in flight', async () => {
        const ctl = createControllableRunner();
        const pool = createFilePool({
            maxConcurrent: 4,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const drained = pool.enqueue(makeItems(10));
        await flushMicrotasks();

        expect(ctl.running).toBe(4);
        expect(ctl.started).toEqual(['f0', 'f1', 'f2', 'f3']);

        await ctl.finish('f0');
        expect(ctl.running).toBe(4);
        expect(ctl.started).toContain('f4');

        for (const item of makeItems(10).slice(1)) await ctl.finish(item.id);
        await drained;
        expect(ctl.peak).toBe(4);
        expect(ctl.started).toHaveLength(10);
    });

    it('stops admitting once summed in-flight bytes reach maxInFlightBytes', async () => {
        const ctl = createControllableRunner();
        const pool = createFilePool({
            maxConcurrent: 4,
            maxInFlightBytes: 32 * GiB,
            run: ctl.run,
        });

        const drained = pool.enqueue([
            { id: 'v0', size: 15 * GiB },
            { id: 'v1', size: 15 * GiB },
            { id: 'v2', size: 15 * GiB },
            { id: 'v3', size: 15 * GiB },
        ]);
        await flushMicrotasks();

        // Two fit under the 32 GiB ceiling; a third would put 45 GiB in flight.
        expect(ctl.started).toEqual(['v0', 'v1']);

        await ctl.finish('v0');
        expect(ctl.started).toEqual(['v0', 'v1', 'v2']);

        await ctl.finish('v1');
        await ctl.finish('v2');
        await ctl.finish('v3');
        await drained;
    });

    it('admits a single file larger than maxInFlightBytes', async () => {
        const ctl = createControllableRunner();
        const pool = createFilePool({
            maxConcurrent: 4,
            maxInFlightBytes: 32 * GiB,
            run: ctl.run,
        });

        const drained = pool.enqueue([
            { id: 'huge', size: 60 * GiB },
            { id: 'small', size: 1 },
        ]);
        await flushMicrotasks();

        // The oversized file runs alone rather than never running.
        expect(ctl.started).toEqual(['huge']);

        await ctl.finish('huge');
        expect(ctl.started).toEqual(['huge', 'small']);
        await ctl.finish('small');
        await drained;
    });

    it('keeps the wave running when one file fails', async () => {
        const ctl = createControllableRunner();
        ctl.failures.add('f1');
        const pool = createFilePool({
            maxConcurrent: 2,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const drained = pool.enqueue(makeItems(4));
        await flushMicrotasks();

        await ctl.finish('f1');
        // The failure frees its slot instead of poisoning the pool.
        expect(ctl.started).toContain('f2');

        await ctl.finish('f0');
        await ctl.finish('f2');
        await ctl.finish('f3');
        await expect(drained).resolves.toBeUndefined();
        expect(ctl.started).toHaveLength(4);
    });

    it('halts the queue but lets in-flight files finish', async () => {
        const ctl = createControllableRunner();
        ctl.outcomes.set('f0', 'halt');
        const pool = createFilePool({
            maxConcurrent: 2,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const drained = pool.enqueue(makeItems(6));
        await flushMicrotasks();
        expect(ctl.started).toEqual(['f0', 'f1']);

        await ctl.finish('f0');
        // f1 was already admitted and keeps going; nothing new starts.
        expect(ctl.started).toEqual(['f0', 'f1']);
        expect(ctl.running).toBe(1);

        await ctl.finish('f1');
        await drained;
        expect(ctl.started).toEqual(['f0', 'f1']);
    });

    it('reports the queued items a halt threw away', async () => {
        const ctl = createControllableRunner();
        ctl.outcomes.set('f0', 'halt');
        const dropped: string[] = [];
        const pool = createFilePool({
            maxConcurrent: 2,
            maxInFlightBytes: Infinity,
            run: ctl.run,
            onDropped: (items) => dropped.push(...items.map((i) => i.id)),
        });

        const drained = pool.enqueue(makeItems(6));
        await flushMicrotasks();
        await ctl.finish('f0');
        await ctl.finish('f1');
        await drained;

        // Exactly the never-started remainder, so the caller can reset those
        // rows — the two in-flight files report through their own outcomes.
        expect(dropped).toEqual(['f2', 'f3', 'f4', 'f5']);
    });

    it('runs work enqueued after a halt, while the halted wave drains', async () => {
        // The user's Retry click on the quota-failed row lands while its
        // siblings are still finishing. Latching the halt would drop it and
        // strand the row in `pending` with nothing left to start it.
        const ctl = createControllableRunner();
        ctl.outcomes.set('f0', 'halt');
        const pool = createFilePool({
            maxConcurrent: 2,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const drained = pool.enqueue(makeItems(6));
        await flushMicrotasks();
        await ctl.finish('f0');
        expect(ctl.started).toEqual(['f0', 'f1']);

        pool.enqueue([{ id: 'retried', size: 1 }]);
        await flushMicrotasks();
        expect(ctl.started).toEqual(['f0', 'f1', 'retried']);

        await ctl.finish('f1');
        await ctl.finish('retried');
        await drained;
    });

    it('clears the halt for the next wave', async () => {
        const ctl = createControllableRunner();
        ctl.outcomes.set('f0', 'halt');
        const pool = createFilePool({
            maxConcurrent: 1,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const first = pool.enqueue(makeItems(2));
        await flushMicrotasks();
        await ctl.finish('f0');
        await first;
        expect(ctl.started).toEqual(['f0']);

        const second = pool.enqueue([{ id: 'later', size: 1 }]);
        await flushMicrotasks();
        expect(ctl.started).toEqual(['f0', 'later']);
        await ctl.finish('later');
        await second;
    });

    it('joins a live wave instead of starting a second pool', async () => {
        const ctl = createControllableRunner();
        const pool = createFilePool({
            maxConcurrent: 2,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const first = pool.enqueue(makeItems(3));
        await flushMicrotasks();
        expect(ctl.running).toBe(2);

        const second = pool.enqueue([{ id: 'late', size: 1 }]);
        await flushMicrotasks();
        // Still bounded by maxConcurrent across both enqueue calls.
        expect(ctl.running).toBe(2);

        for (const id of ['f0', 'f1', 'f2', 'late']) await ctl.finish(id);
        await Promise.all([first, second]);
        expect(ctl.peak).toBe(2);
    });

    it('ignores items already queued or in flight', async () => {
        const ctl = createControllableRunner();
        const pool = createFilePool({
            maxConcurrent: 1,
            maxInFlightBytes: Infinity,
            run: ctl.run,
        });

        const drained = pool.enqueue(makeItems(2));
        await flushMicrotasks();
        pool.enqueue(makeItems(2));
        await flushMicrotasks();

        await ctl.finish('f0');
        await ctl.finish('f1');
        await drained;
        expect(ctl.started).toEqual(['f0', 'f1']);
    });

    it('fires onDrained once per wave, not once per file', async () => {
        const ctl = createControllableRunner();
        const onDrained = vi.fn();
        const pool = createFilePool({
            maxConcurrent: 4,
            maxInFlightBytes: Infinity,
            run: ctl.run,
            onDrained,
        });

        const drained = pool.enqueue(makeItems(4));
        await flushMicrotasks();
        expect(onDrained).not.toHaveBeenCalled();

        for (const item of makeItems(4)) await ctl.finish(item.id);
        await drained;
        expect(onDrained).toHaveBeenCalledTimes(1);
    });
});

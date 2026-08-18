import { describe, expect, it } from 'vitest';
import { deferred, flushMicrotasks } from './testing';
import { createSemaphore } from './semaphore';

describe('createSemaphore', () => {
    it('runs up to `permits` tasks concurrently and queues the rest', async () => {
        const semaphore = createSemaphore(2);
        const gates = [deferred(), deferred(), deferred()];
        let running = 0;
        let peak = 0;

        const runs = gates.map((gate) =>
            semaphore.run(async () => {
                running++;
                peak = Math.max(peak, running);
                await gate.promise;
                running--;
            })
        );

        await flushMicrotasks();
        expect(running).toBe(2);

        gates[0].resolve();
        await flushMicrotasks();
        // The third task only starts once a permit comes free.
        expect(running).toBe(2);
        expect(peak).toBe(2);

        gates[1].resolve();
        gates[2].resolve();
        await Promise.all(runs);
        expect(peak).toBe(2);
    });

    it('hands permits over in FIFO order', async () => {
        const semaphore = createSemaphore(1);
        const first = deferred();
        const started: number[] = [];

        const runs = [0, 1, 2, 3].map((i) =>
            semaphore.run(async () => {
                started.push(i);
                if (i === 0) await first.promise;
            })
        );

        await flushMicrotasks();
        expect(started).toEqual([0]);

        first.resolve();
        await Promise.all(runs);
        expect(started).toEqual([0, 1, 2, 3]);
    });

    it('releases the permit when a task throws', async () => {
        const semaphore = createSemaphore(1);

        await expect(
            semaphore.run(() => Promise.reject(new Error('boom')))
        ).rejects.toThrow('boom');

        // A leaked permit would deadlock this call instead of resolving.
        await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
    });

    it('returns the task result', async () => {
        const semaphore = createSemaphore(1);
        await expect(semaphore.run(async () => 42)).resolves.toBe(42);
    });
});

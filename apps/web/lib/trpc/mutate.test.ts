import { describe, expect, it, vi } from 'vitest';
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { createFireAndForgetFn, createMutateFn } from './mutate';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('createMutateFn', () => {
    // The upload session shares one observer across every file in flight.
    it('runs overlapping calls as mutations of their own, each with its own result', async () => {
        const gates = new Map([
            ['a', deferred<string>()],
            ['b', deferred<string>()],
        ]);
        const upload = createMutateFn(new QueryClient(), {
            mutationFn: (name: string) => gates.get(name)!.promise,
        });

        const a = upload('a');
        const b = upload('b');
        gates.get('b')!.resolve('b done');
        gates.get('a')!.resolve('a done');

        expect(await Promise.all([a, b])).toEqual(['a done', 'b done']);
    });

    it('applies the options’ retries, and the MutationCache reports the failure once', async () => {
        const onError = vi.fn();
        const queryClient = new QueryClient({
            mutationCache: new MutationCache({ onError }),
        });
        const mutationFn = vi.fn(async () => {
            throw new Error('down');
        });
        const confirm = createMutateFn(queryClient, {
            mutationFn,
            retry: 2,
            retryDelay: 0,
        });

        await expect(confirm(undefined)).rejects.toThrow('down');
        expect(mutationFn).toHaveBeenCalledTimes(3);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});

describe('createFireAndForgetFn', () => {
    // Vitest fails the run on an unhandled rejection, so this goes red if the
    // failure escapes.
    it('swallows a failure, and keeps the call in flight until it settles', async () => {
        const gate = deferred<void>();
        const inFlight = new Set<Promise<unknown>>();
        const release = createFireAndForgetFn(
            new QueryClient(),
            {
                mutationFn: async () => {
                    await gate.promise;
                    throw new Error('down');
                },
            },
            inFlight
        );

        release(undefined);
        expect(inFlight.size).toBe(1);

        gate.resolve();
        await Promise.all(inFlight);
        await vi.waitFor(() => expect(inFlight.size).toBe(0));
    });
});

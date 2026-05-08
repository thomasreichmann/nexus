import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ logErrorMock: vi.fn() }));

vi.mock('@/lib/logger/client', () => ({
    log: { error: hoisted.logErrorMock },
}));

import { QueryClient } from '@tanstack/react-query';
import { makeQueryClient } from './query-client';

describe('makeQueryClient', () => {
    it('logs query errors via QueryCache.onError', async () => {
        hoisted.logErrorMock.mockClear();
        const client: QueryClient = makeQueryClient();

        const error = new Error('Query data cannot be undefined.');
        await client
            .fetchQuery({
                queryKey: ['foo'],
                queryFn: () => {
                    throw error;
                },
                retry: false,
            })
            .catch(() => {});

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({ err: error, queryKey: ['foo'] });
        expect(msg).toBe('Query data cannot be undefined.');
    });

    it('logs mutation errors via MutationCache.onError', async () => {
        hoisted.logErrorMock.mockClear();
        const client: QueryClient = makeQueryClient();

        const error = new Error('mutation failed');
        await client
            .getMutationCache()
            .build(client, {
                mutationKey: ['createThing'],
                mutationFn: () => {
                    throw error;
                },
                retry: false,
            })
            .execute(undefined)
            .catch(() => {});

        expect(hoisted.logErrorMock).toHaveBeenCalledOnce();
        const [meta, msg] = hoisted.logErrorMock.mock.calls[0]!;
        expect(meta).toMatchObject({
            err: error,
            mutationKey: ['createThing'],
        });
        expect(msg).toBe('mutation failed');
    });
});

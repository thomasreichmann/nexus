import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { log } from '@/lib/logger/client';

import { reportUnexpectedClientError } from './error-reporting';

export function makeQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 60 * 1000,
            },
        },
        queryCache: new QueryCache({
            onError(error, query) {
                log.error(
                    { err: error, queryKey: query.queryKey },
                    error.message || 'query error'
                );
                reportUnexpectedClientError(error, {
                    queryKey: query.queryKey,
                });
            },
        }),
        mutationCache: new MutationCache({
            onError(error, _variables, _context, mutation) {
                log.error(
                    { err: error, mutationKey: mutation.options.mutationKey },
                    error.message || 'mutation error'
                );
                reportUnexpectedClientError(error, {
                    mutationKey: mutation.options.mutationKey,
                });
            },
        }),
    });
}

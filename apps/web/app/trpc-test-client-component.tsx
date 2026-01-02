'use client';

import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';

export function TrpcTestClientComponent() {
    const trpc = useTRPC();

    const randomQuery = useQuery(
        trpc.debug.random.queryOptions(undefined, {
            refetchInterval: 3000,
            refetchIntervalInBackground: true,
            staleTime: 0,
        })
    );

    return (
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-zinc-900 shadow-sm dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-50">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">tRPC live test</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    updated{' '}
                    {randomQuery.dataUpdatedAt
                        ? new Date(
                              randomQuery.dataUpdatedAt
                          ).toLocaleTimeString()
                        : '—'}
                </div>
            </div>

            <div className="mt-3 grid gap-1">
                <div className="flex items-center justify-between gap-3">
                    <div className="text-zinc-500 dark:text-zinc-400">
                        status
                    </div>
                    <div className="font-mono">
                        {randomQuery.isLoading
                            ? 'loading'
                            : randomQuery.isError
                              ? 'error'
                              : randomQuery.isFetching
                                ? 'fetching'
                                : 'success'}
                    </div>
                </div>

                {randomQuery.isError ? (
                    <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">
                        {randomQuery.error.message}
                    </div>
                ) : null}

                {randomQuery.data ? (
                    <>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-zinc-500 dark:text-zinc-400">
                                now
                            </div>
                            <div className="font-mono">
                                {new Date(
                                    randomQuery.data.now
                                ).toLocaleTimeString()}
                            </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-zinc-500 dark:text-zinc-400">
                                random
                            </div>
                            <div className="font-mono">
                                {randomQuery.data.random.toFixed(6)}
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}

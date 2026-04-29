'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';

/**
 * Invalidates every cached variant of `files.list` and `files.statusCounts`
 * via procedure-level prefix filters. Use this whenever a mutation changes
 * the user's file set — exact-key invalidation would miss paginated/searched
 * variants, and the stats bar query is separate from the list query.
 */
export function useInvalidateFileList() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const listFilter = useMemo(() => trpc.files.list.queryFilter(), [trpc]);
    const countsFilter = useMemo(
        () => trpc.files.statusCounts.queryFilter(),
        [trpc]
    );
    return useCallback(
        () =>
            Promise.all([
                queryClient.invalidateQueries(listFilter),
                queryClient.invalidateQueries(countsFilter),
            ]),
        [queryClient, listFilter, countsFilter]
    );
}

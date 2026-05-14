'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';

/**
 * Invalidates every cached variant of `files.list`, `files.listGrouped`, and
 * `files.statusCounts` via procedure-level prefix filters. Use this whenever a
 * mutation changes the user's file set — exact-key invalidation would miss
 * paginated/searched variants, and the stats bar query is separate from list.
 */
export function useInvalidateFileList() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    return useCallback(
        () =>
            Promise.all([
                queryClient.invalidateQueries(trpc.files.list.queryFilter()),
                queryClient.invalidateQueries(
                    trpc.files.listGrouped.queryFilter()
                ),
                queryClient.invalidateQueries(
                    trpc.files.statusCounts.queryFilter()
                ),
            ]),
        [trpc, queryClient]
    );
}

'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';

/**
 * Invalidates every cached variant of `files.list` via a procedure-level
 * prefix filter. Use this whenever a mutation changes the user's file set —
 * exact-key invalidation would miss paginated/searched variants.
 */
export function useInvalidateFileList() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const filter = trpc.files.list.queryFilter();
    return useCallback(
        () => queryClient.invalidateQueries(filter),
        [queryClient, filter]
    );
}

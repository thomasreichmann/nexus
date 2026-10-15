'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/client';

/**
 * Invalidates every cached variant of `files.list`, the file browser's
 * library queries (`listBatches`, `getBatch`, `listBatchFiles`), and
 * `files.statusCounts`, via procedure-level prefix filters. Use this whenever
 * a mutation changes the user's file set — exact-key invalidation would miss
 * paginated/searched variants, and the stats bar query is separate from list.
 *
 * `listBatches` is an infinite query, which a `queryFilter()` (a plain
 * query's key) doesn't match, so the library's filters are by path. Not
 * `files.locate`: a deep link's answer is where the browser opened, and a
 * refetch moving it would reset the open batch's pages under the user.
 *
 * Storage rollups ride along: anything that changes the file set moves
 * `storage.getUsage` (the sidebar bar would otherwise sit on its pre-upload
 * number right next to a fresh "all uploaded" message) and the dashboard's
 * `storage.getUploadHistory` chart.
 */
export function useInvalidateFileList() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    return useCallback(
        () =>
            Promise.all([
                queryClient.invalidateQueries(trpc.files.list.queryFilter()),
                queryClient.invalidateQueries(
                    trpc.files.listBatches.pathFilter()
                ),
                queryClient.invalidateQueries(trpc.files.getBatch.pathFilter()),
                queryClient.invalidateQueries(
                    trpc.files.listBatchFiles.pathFilter()
                ),
                queryClient.invalidateQueries(
                    trpc.files.statusCounts.queryFilter()
                ),
                queryClient.invalidateQueries(
                    trpc.storage.getUsage.queryFilter()
                ),
                queryClient.invalidateQueries(
                    trpc.storage.getUploadHistory.queryFilter()
                ),
            ]),
        [trpc, queryClient]
    );
}

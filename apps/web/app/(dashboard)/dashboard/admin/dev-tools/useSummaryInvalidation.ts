'use client';

import { useTRPC } from '@/lib/trpc/client';
import { useQueryClient } from '@tanstack/react-query';

export function useSummaryInvalidation() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const summaryKey = trpc.admin.devTools.summary.queryOptions().queryKey;

    async function invalidateSummary() {
        // The summary fetch kicked off on page load can still be in flight when
        // a seed/cleanup mutation settles. A plain invalidate dedupes against
        // that in-flight request and keeps its pre-mutation (stale) result, so
        // the UI — e.g. the "Clean" button's enabled state — stays out of sync
        // until the next natural refetch. Cancel the in-flight fetch first, then
        // refetch, so the summary always reflects the mutation.
        await queryClient.cancelQueries({ queryKey: summaryKey });
        await queryClient.refetchQueries({ queryKey: summaryKey });
    }

    return { invalidateSummary };
}

'use client';

import { useTRPC } from '@/lib/trpc/client';
import { useQueryClient } from '@tanstack/react-query';

export function useSummaryInvalidation() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const summaryKey = trpc.admin.devTools.summary.queryOptions().queryKey;

    function invalidateSummary() {
        queryClient.invalidateQueries({ queryKey: summaryKey });
    }

    return { invalidateSummary };
}

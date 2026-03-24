'use client';

import { useTRPC } from '@/lib/trpc/client';
import { useMutation } from '@tanstack/react-query';
import { ME_VALUE } from './presets';
import { useSummaryInvalidation } from './useSummaryInvalidation';

export function useSeedTools() {
    const trpc = useTRPC();
    const { invalidateSummary } = useSummaryInvalidation();

    const seedForMe = useMutation(
        trpc.admin.devTools.seedForMe.mutationOptions({
            onSuccess: invalidateSummary,
        })
    );

    const seedForUser = useMutation(
        trpc.admin.devTools.seedForUser.mutationOptions({
            onSuccess: invalidateSummary,
        })
    );

    function seed(
        targetUser: string,
        params: {
            fileCount: number;
            retrievalCount: number;
            storageTierDistribution?: {
                standard: number;
                glacier: number;
                deep_archive: number;
            };
        },
        callbacks?: {
            onSuccess?: (data: { files: number; retrievals: number }) => void;
            onSettled?: () => void;
        }
    ) {
        if (targetUser === ME_VALUE) {
            seedForMe.mutate(params, callbacks);
        } else {
            seedForUser.mutate({ userId: targetUser, ...params }, callbacks);
        }
    }

    return {
        seed,
        isPending: seedForMe.isPending || seedForUser.isPending,
        isSuccess: seedForMe.isSuccess || seedForUser.isSuccess,
        lastData: seedForMe.data ?? seedForUser.data,
    };
}

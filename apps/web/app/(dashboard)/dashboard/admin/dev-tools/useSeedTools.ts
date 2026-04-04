'use client';

import { useState } from 'react';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation } from '@tanstack/react-query';
import { ME_VALUE } from './presets';
import { useSummaryInvalidation } from './useSummaryInvalidation';

export function useSeedTools() {
    const trpc = useTRPC();
    const { invalidateSummary } = useSummaryInvalidation();
    const [lastBranch, setLastBranch] = useState<'me' | 'user'>('me');

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
            setLastBranch('me');
            seedForMe.mutate(params, callbacks);
        } else {
            setLastBranch('user');
            seedForUser.mutate({ userId: targetUser, ...params }, callbacks);
        }
    }

    const lastMutation = lastBranch === 'me' ? seedForMe : seedForUser;

    return {
        seed,
        isPending: seedForMe.isPending || seedForUser.isPending,
        isSuccess: lastMutation.isSuccess,
        lastData: lastMutation.data,
    };
}

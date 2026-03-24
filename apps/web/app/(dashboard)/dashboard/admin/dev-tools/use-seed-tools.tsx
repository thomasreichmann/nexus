'use client';

import { cn } from '@/lib/cn';
import { useTRPC } from '@/lib/trpc/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ME_VALUE } from './presets';

export function TierBar({
    distribution,
    className,
}: {
    distribution: { standard: number; glacier: number; deep_archive: number };
    className?: string;
}) {
    return (
        <div
            className={cn(
                'flex h-1 w-full overflow-hidden rounded-full bg-zinc-800/80',
                className
            )}
        >
            <div
                className="bg-emerald-400/60"
                style={{ width: `${distribution.standard * 100}%` }}
            />
            <div
                className="bg-cyan-400/60"
                style={{ width: `${distribution.glacier * 100}%` }}
            />
            <div
                className="bg-violet-400/60"
                style={{ width: `${distribution.deep_archive * 100}%` }}
            />
        </div>
    );
}

export function useSeedTools() {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const summaryKey = trpc.admin.devTools.summary.queryOptions().queryKey;

    const { data: allUsers } = useQuery(
        trpc.admin.devTools.users.queryOptions()
    );

    const seedForMe = useMutation(
        trpc.admin.devTools.seedForMe.mutationOptions({
            onSuccess() {
                queryClient.invalidateQueries({ queryKey: summaryKey });
            },
        })
    );

    const seedForUser = useMutation(
        trpc.admin.devTools.seedForUser.mutationOptions({
            onSuccess() {
                queryClient.invalidateQueries({ queryKey: summaryKey });
            },
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
        users: allUsers ?? [],
        seed,
        isPending: seedForMe.isPending || seedForUser.isPending,
        isSuccess: seedForMe.isSuccess || seedForUser.isSuccess,
        lastData: seedForMe.data ?? seedForUser.data,
    };
}

'use client';

import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';

export function UserInfoClient() {
    const trpc = useTRPC();
    const { data: user, isLoading } = useQuery(trpc.auth.me.queryOptions());

    if (isLoading) {
        return (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
                <p className="text-sm text-blue-600 dark:text-blue-400">
                    Loading tRPC...
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
            <p className="text-xs font-medium uppercase text-blue-500 dark:text-blue-400">
                tRPC (Client)
            </p>
            {user ? (
                <div className="mt-1">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                        {user.name}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                        {user.email}
                    </p>
                </div>
            ) : (
                <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                    Not logged in
                </p>
            )}
        </div>
    );
}

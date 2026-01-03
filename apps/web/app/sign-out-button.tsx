'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/lib/auth/client';

export function SignOutButton() {
    const router = useRouter();
    const queryClient = useQueryClient();

    async function handleSignOut() {
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => {
                    // Invalidate all queries to clear cached user data
                    queryClient.invalidateQueries();
                    router.push('/');
                    router.refresh();
                },
            },
        });
    }

    return (
        <button
            onClick={handleSignOut}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-solid border-red-200 px-5 text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 md:w-[158px]"
        >
            Sign Out
        </button>
    );
}

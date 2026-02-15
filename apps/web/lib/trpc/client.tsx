'use client';

import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import { useState } from 'react';
import superjson from 'superjson';

import type { AppRouter } from '@/server/trpc/router';

import { errorLink } from './error-link';
import { makeQueryClient } from './query-client';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

let clientQueryClientSingleton: QueryClient;

function getQueryClient() {
    if (typeof window === 'undefined') {
        return makeQueryClient();
    }
    return (clientQueryClientSingleton ??= makeQueryClient());
}

function getUrl() {
    const base = (() => {
        if (typeof window !== 'undefined') return '';
        if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
        return 'http://localhost:3000';
    })();
    return `${base}/api/trpc`;
}

export function TRPCReactProvider({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const queryClient = getQueryClient();

    const [trpcClient] = useState(() =>
        createTRPCClient<AppRouter>({
            links: [
                errorLink(),
                httpBatchLink({
                    transformer: superjson,
                    url: getUrl(),
                }),
            ],
        })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
                {children}
            </TRPCProvider>
        </QueryClientProvider>
    );
}

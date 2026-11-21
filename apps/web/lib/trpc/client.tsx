'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
    createTRPCClient,
    httpBatchLink,
    httpLink,
    splitLink,
    type TRPCClient,
} from '@trpc/client';
import {
    createTRPCContext,
    createTRPCOptionsProxy,
    type TRPCOptionsProxy,
} from '@trpc/tanstack-react-query';
import superjson from 'superjson';

import type { AppRouter } from '@/server/trpc/router';

import { errorLink } from './error-link';
import { makeQueryClient } from './query-client';
import type { QueryClient } from '@tanstack/react-query';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

let clientQueryClientSingleton: QueryClient;
let clientTRPCClientSingleton: TRPCClient<AppRouter>;
let clientTRPCSingleton: TRPCOptionsProxy<AppRouter>;

export function getQueryClient(): QueryClient {
    if (typeof window === 'undefined') {
        return makeQueryClient();
    }
    return (clientQueryClientSingleton ??= makeQueryClient());
}

function getTRPCClient() {
    if (typeof window === 'undefined') {
        return makeTRPCClient();
    }
    return (clientTRPCClientSingleton ??= makeTRPCClient());
}

/**
 * What `useTRPC` returns, for browser code that outlives any component: the
 * upload session runs its mutations through it so a wave survives the page
 * that started it (#399). Built on the provider's own client and QueryClient,
 * so its calls get the same error toasts, retries and Sentry reporting.
 */
export function getTRPC(): TRPCOptionsProxy<AppRouter> {
    if (typeof window === 'undefined') {
        return makeTRPC();
    }
    return (clientTRPCSingleton ??= makeTRPC());
}

function makeTRPC() {
    return createTRPCOptionsProxy<AppRouter>({
        client: getTRPCClient(),
        queryClient: getQueryClient(),
    });
}

function makeTRPCClient() {
    return createTRPCClient<AppRouter>({
        links: [
            errorLink(),
            // A batch answers when its slowest call does. A call that mustn't
            // wait on its neighbours asks for `skipBatch` and goes alone: a
            // deep link's `files.locate` beside the library's first page
            // (#546).
            splitLink({
                condition: (op) => op.context.skipBatch === true,
                true: httpLink({ transformer: superjson, url: getUrl() }),
                false: httpBatchLink({ transformer: superjson, url: getUrl() }),
            }),
        ],
    });
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
    const [trpcClient] = useState(getTRPCClient);

    return (
        <QueryClientProvider client={queryClient}>
            <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
                {children}
            </TRPCProvider>
        </QueryClientProvider>
    );
}

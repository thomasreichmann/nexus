import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { toast } from 'sonner';

import type { AppRouter } from '@/server/trpc/router';

// Fallback messages for codes where the server message may be
// technical or empty. For other codes the server's own message
// (set by DomainError subclasses) is already user-facing.
const fallbackMessages: Record<string, string> = {
    UNAUTHORIZED: 'Please sign in to continue',
    TOO_MANY_REQUESTS: 'Too many requests. Please slow down',
    INTERNAL_SERVER_ERROR: 'Something went wrong. Please try again',
};

export function getErrorMessage(err: TRPCClientError<AppRouter>): string {
    const code = (err.data?.code as string) ?? 'INTERNAL_SERVER_ERROR';
    const fallback =
        fallbackMessages[code] ?? fallbackMessages.INTERNAL_SERVER_ERROR!;

    // INTERNAL_SERVER_ERROR messages may leak implementation details
    if (code === 'INTERNAL_SERVER_ERROR') return fallback;

    return err.message || fallback;
}

/**
 * Toast id includes both tRPC code and `domainCode` so two DomainErrors
 * sharing a tRPC code (e.g. FORBIDDEN vs TRIAL_EXPIRED) surface as distinct
 * toasts instead of collapsing into one.
 */
export function getToastId(err: TRPCClientError<AppRouter>): string {
    const code = (err.data?.code as string) ?? 'INTERNAL_SERVER_ERROR';
    const domainCode = err.data?.domainCode ?? '';
    return `trpc-${code}-${domainCode}`;
}

export function errorLink(): TRPCLink<AppRouter> {
    return () => {
        return ({ next, op }) => {
            return observable((observer) => {
                const unsubscribe = next(op).subscribe({
                    next(value) {
                        observer.next(value);
                    },
                    error(err) {
                        if (
                            !op.context.skipToast &&
                            err instanceof TRPCClientError
                        ) {
                            toast.error(getErrorMessage(err), {
                                id: getToastId(err),
                            });
                        }
                        observer.error(err);
                    },
                    complete() {
                        observer.complete();
                    },
                });
                return unsubscribe;
            });
        };
    };
}

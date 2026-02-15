import { TRPCClientError, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { toast } from 'sonner';

import type { AppRouter } from '@/server/trpc/router';

const errorMessages: Record<string, string> = {
    UNAUTHORIZED: 'Please sign in to continue',
    FORBIDDEN: 'You do not have permission',
    NOT_FOUND: 'The requested resource was not found',
    TOO_MANY_REQUESTS: 'Too many requests. Please slow down',
    INTERNAL_SERVER_ERROR: 'Something went wrong. Please try again',
};

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
                            const code =
                                (err.data?.code as string) ??
                                'INTERNAL_SERVER_ERROR';
                            const message =
                                errorMessages[code] ??
                                errorMessages.INTERNAL_SERVER_ERROR;
                            toast.error(message, {
                                id: `trpc-${code}`,
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

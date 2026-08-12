import {
    TRPCClientError,
    type OperationContext,
    type TRPCLink,
} from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { toast } from 'sonner';

import type { DomainErrorCode } from '@/lib/errors/codes';
import type { AppRouter } from '@/server/trpc/router';

/**
 * Per-operation knobs read by `errorLink`, passed as the tRPC operation
 * context. Always build the context through {@link toastContext} — the raw
 * context is `Record<string, unknown>`, so a typo'd key in a bare object
 * literal compiles fine and silently re-enables the toast it meant to
 * configure.
 */
export interface ErrorToastContext {
    /**
     * Suppress the error toast entirely. For call sites that render the
     * error some other way (e.g. the dev-tools error controls, which feed
     * it to a banner) — not for substituting their own toast; use
     * `errorMessage` for that.
     */
    skipToast?: boolean;
    /**
     * Replaces only the last-resort generic ("Something went wrong") for
     * errors with no user-facing message — 500s and transport failures.
     * Domain errors and code-specific copy still win over it.
     */
    errorMessage?: string;
}

export function toastContext(ctx: ErrorToastContext): {
    context: OperationContext;
} {
    // Spread: the interface has no index signature (deliberately — one would
    // readmit arbitrary keys), so it only satisfies OperationContext as a
    // fresh literal.
    return { context: { ...ctx } };
}

// User-facing copy per domain code, for codes whose server message is
// written for logs rather than people (NotFoundError says "File not found:
// <uuid>"). Codes absent here fall through to the server message, which the
// remaining DomainError subclasses already write user-facing.
const domainErrorMessages: Partial<Record<DomainErrorCode, string>> = {
    NOT_FOUND: 'That item is no longer available',
};

// Fallback messages for codes where the server message may be
// technical or empty. For other codes the server's own message
// (set by DomainError subclasses) is already user-facing.
const fallbackMessages: Record<string, string> = {
    UNAUTHORIZED: 'Please sign in to continue',
    TOO_MANY_REQUESTS: 'Too many requests. Please slow down',
};

const GENERIC_MESSAGE = 'Something went wrong. Please try again';

export function getErrorMessage(
    err: TRPCClientError<AppRouter>,
    contextMessage?: string
): string {
    const code = (err.data?.code as string) ?? 'INTERNAL_SERVER_ERROR';
    const domainCode = err.data?.domainCode as DomainErrorCode | undefined;

    const domainMessage = domainCode && domainErrorMessages[domainCode];
    if (domainMessage) return domainMessage;

    // INTERNAL_SERVER_ERROR messages may leak implementation details
    if (code === 'INTERNAL_SERVER_ERROR') {
        return contextMessage ?? GENERIC_MESSAGE;
    }

    return (
        err.message ||
        fallbackMessages[code] ||
        contextMessage ||
        GENERIC_MESSAGE
    );
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
                        const ctx = op.context as ErrorToastContext;
                        if (!ctx.skipToast && err instanceof TRPCClientError) {
                            toast.error(
                                getErrorMessage(err, ctx.errorMessage),
                                { id: getToastId(err) }
                            );
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

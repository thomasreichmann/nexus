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

// A stack frame, whether the message is a bare trace or prose with one glued
// on. Anchored per-line so an `at` inside a sentence can't trip it.
const STACK_FRAME = /^\s+at\s+\S/m;

/**
 * Whether a server message was written for a machine rather than a person.
 *
 * Deliberately structural — domain errors write their own user-facing copy and
 * must keep reaching the toast verbatim, so this looks for shapes prose never
 * takes, never at message length or vocabulary. Zod v4 puts its whole issue
 * list in `error.message` and a validation failure carries no `domainCode`, so
 * without this gate the raw payload goes straight into the toast (#400).
 *
 * The serialized-structure half parses instead of pattern-matching: only a
 * message that *is* an object or array is a dump, so a sentence that merely
 * opens with a bracket and quotes a key later (`[Beta] limits: {"max": 100}`)
 * stays prose.
 */
function isMachineGenerated(message: string): boolean {
    const trimmed = message.trim();
    if (STACK_FRAME.test(trimmed)) return true;
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return false;
    try {
        return typeof JSON.parse(trimmed) === 'object';
    } catch {
        return false;
    }
}

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

    // A non-prose message is treated as empty, so the code fallbacks apply.
    const serverMessage = isMachineGenerated(err.message) ? '' : err.message;

    return (
        serverMessage ||
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

import { isDomainError } from '@/server/errors';
import type { TRPCError } from '@trpc/server';

// Kept free of heavy imports (logger, Sentry): the error formatter runs in
// every tRPC init path, including minimal test setups that stub nothing.

export interface ZodLikeIssue {
    path: PropertyKey[];
    message: string;
}

/** Duck-type check for ZodError (avoids cross-module instanceof issues). */
export function isZodError(
    error: unknown
): error is Error & { issues: ZodLikeIssue[] } {
    return (
        error instanceof Error &&
        'issues' in error &&
        Array.isArray((error as { issues: unknown }).issues)
    );
}

/**
 * Expected failures are product behavior, not defects: domain errors (typed
 * 4xx-class outcomes), Zod input validation, and bare non-500 TRPCErrors —
 * a TRPCError with no cause is always a deliberate throw (auth gates,
 * admin.retry's NOT_FOUND/BAD_REQUEST), since a real exception arrives
 * wrapped with `cause` set. Everything else is a bug Sentry should own.
 * The verdict is serialized to the client as `data.expected` by
 * server/trpc/error-formatter.ts, so the client-side filter
 * (lib/trpc/error-reporting.ts) reads it instead of mirroring the policy.
 */
export function isUnexpectedTrpcError(error: TRPCError): boolean {
    if (isDomainError(error.cause)) return false;
    if (isZodError(error.cause)) return false;
    if (error.cause === undefined && error.code !== 'INTERNAL_SERVER_ERROR') {
        return false;
    }
    return true;
}

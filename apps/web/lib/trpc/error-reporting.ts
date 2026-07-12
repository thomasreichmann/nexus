import * as Sentry from '@sentry/nextjs';
import { TRPCClientError } from '@trpc/client';

/**
 * Client-side mirror of `isUnexpectedTrpcError` (server/trpc/middleware/
 * logging.ts), applied to the serialized shape the client sees: domain errors
 * (`data.domainCode`), input validation (bare BAD_REQUEST), and auth-gate
 * rejections (bare UNAUTHORIZED/FORBIDDEN) are expected product behavior.
 * Everything else is worth a Sentry event — server 500s (captured on both
 * sides on purpose: the server event has the real stack, the client event
 * links the on-error session replay), network failures that never reached
 * the server (`data` absent), and non-tRPC errors thrown inside the caches.
 */
export function isUnexpectedClientError(error: unknown): boolean {
    if (!(error instanceof TRPCClientError)) return true;

    const data = error.data as
        | { code?: string; domainCode?: string }
        | undefined;
    if (!data) return true;
    if (data.domainCode) return false;

    return (
        data.code !== 'BAD_REQUEST' &&
        data.code !== 'UNAUTHORIZED' &&
        data.code !== 'FORBIDDEN'
    );
}

/** Capture an unexpected query/mutation failure with its cache context. */
export function reportUnexpectedClientError(
    error: unknown,
    context: Record<string, unknown>
): void {
    if (!isUnexpectedClientError(error)) return;

    Sentry.captureException(error, { contexts: { trpc: context } });
}

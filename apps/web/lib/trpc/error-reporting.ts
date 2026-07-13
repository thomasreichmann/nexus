import * as Sentry from '@sentry/nextjs';
import { TRPCClientError } from '@trpc/client';

/**
 * Reads the server's expected-vs-defect verdict off the serialized error
 * shape (`data.expected`, set by server/trpc/error-formatter.ts from
 * `isUnexpectedTrpcError`): expected product behavior — domain errors, input
 * validation, deliberate bare throws like auth-gate rejections — is not
 * reported. Everything else is worth a Sentry event — server 500s (captured
 * on both sides on purpose: the server event has the real stack, the client
 * event links the on-error session replay), network failures that never
 * reached the server (`data` absent), and non-tRPC errors thrown inside the
 * caches.
 */
export function isUnexpectedClientError(error: unknown): boolean {
    if (!(error instanceof TRPCClientError)) return true;

    const data = error.data as { expected?: boolean } | undefined;
    if (!data) return true;

    return data.expected !== true;
}

/** Capture an unexpected query/mutation failure with its cache context. */
export function reportUnexpectedClientError(
    error: unknown,
    context: Record<string, unknown>
): void {
    if (!isUnexpectedClientError(error)) return;

    Sentry.captureException(error, { contexts: { trpc: context } });
}

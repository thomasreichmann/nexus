import * as Sentry from '@sentry/nextjs';
import { TRPCClientError } from '@trpc/client';

import { UploadHttpError, UploadNetworkError } from '@/lib/http/xhr';

/**
 * Classifies upload failures so the engine can react instead of giving up:
 * an expired presigned URL gets re-presigned, a network drop pauses for
 * reconnect, and a deliberate abort is swallowed.
 */

/** S3 returns 403 for an expired presigned URL — re-presign and retry. */
export function isExpiredUrlError(error: unknown): boolean {
    return error instanceof UploadHttpError && error.status === 403;
}

/** Transport failure with no HTTP response — likely a dropped connection. */
export function isNetworkError(error: unknown): boolean {
    return error instanceof UploadNetworkError;
}

/** The upload was aborted (pause or cancel), not a real failure. */
export function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

/** The slice of an upload row a failure report needs. */
export interface UploadFailureInfo {
    name: string;
    size: number;
    fileId?: string;
    batchId?: string;
}

/**
 * Report a terminal upload failure to Sentry. tRPC mutation failures inside
 * the upload flow (init/confirm/sign-parts) already reach Sentry through the
 * MutationCache capture (lib/trpc/query-client.ts), which also filters
 * expected domain errors like quota-exceeded — skipping them here keeps
 * "captured once" true. What remains is exactly what the server never sees:
 * the browser→S3 presigned PUTs and local upload-store bookkeeping.
 */
export function reportUploadFailure(
    error: unknown,
    engine: 'single' | 'multipart',
    upload: UploadFailureInfo
): void {
    if (error instanceof TRPCClientError) return;

    Sentry.captureException(error, {
        tags: { feature: 'upload', engine },
        contexts: {
            upload: {
                fileId: upload.fileId,
                fileName: upload.name,
                sizeBytes: upload.size,
                batchId: upload.batchId,
            },
        },
    });
}

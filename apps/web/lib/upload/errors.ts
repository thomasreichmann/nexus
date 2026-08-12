import * as Sentry from '@sentry/nextjs';
import { TRPCClientError } from '@trpc/client';

import { UploadHttpError, UploadNetworkError } from '@/lib/http/xhr';
import { captureEvent } from '@/lib/posthog/client';
import { PostHogEvent } from '@/lib/posthog/events';

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

/** Which upload path moved the bytes. */
export type UploadEngine = 'single' | 'multipart';

/** The slice of an upload row a failure report or upload event needs. */
export interface UploadFailureInfo {
    /** Client row id — joins this failure to its `upload_started` attempt. */
    id: string;
    name: string;
    size: number;
    fileId?: string;
    batchId?: string;
}

/**
 * The properties every upload event carries, so the three capture sites
 * (started, completed, failed) can't drift apart. They have to agree: a
 * started→completed funnel joins on `clientUploadId`, and one site renaming a
 * field splits that funnel silently rather than failing.
 *
 * `engine` is separate from the row because a resumed multipart upload and the
 * single-part attempt before it are the same row.
 */
export function uploadEventProps(
    engine: UploadEngine,
    upload: UploadFailureInfo
): Record<string, unknown> {
    return {
        engine,
        fileId: upload.fileId,
        sizeBytes: upload.size,
        batchId: upload.batchId,
        clientUploadId: upload.id,
    };
}

/**
 * Report a terminal upload failure. Callers have already filtered the
 * non-failures (aborts, pauses, offline drops), so everything reaching here is
 * an upload the user lost.
 *
 * The two sinks disagree on scope by design. PostHog wants every lost upload,
 * quota rejections included — "tester hit the quota and stopped" is the
 * funnel drop-off the analytics exist to surface. Sentry wants only the
 * unexpected ones: tRPC mutation failures inside the upload flow
 * (init/confirm/sign-parts) already reach Sentry through the MutationCache
 * capture (lib/trpc/query-client.ts), which also filters expected domain
 * errors like quota-exceeded, so skipping them here keeps "captured once"
 * true. What remains for Sentry is exactly what the server never sees: the
 * browser→S3 presigned PUTs and local upload-store bookkeeping.
 */
export function reportUploadFailure(
    error: unknown,
    engine: UploadEngine,
    upload: UploadFailureInfo
): void {
    captureEvent(PostHogEvent.UploadFailed, {
        ...uploadEventProps(engine, upload),
        // Distinguishes a server-side rejection (quota, auth) from a
        // browser→S3 transport failure without shipping the message.
        isServerRejection: error instanceof TRPCClientError,
    });

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

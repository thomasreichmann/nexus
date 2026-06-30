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

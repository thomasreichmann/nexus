import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { client, bucket } from './client';
import type { PutPresignOptions, GetPresignOptions } from './types';

/**
 * Generate a presigned URL for uploading an object
 * @param key - S3 object key
 * @param options - Optional content type, content length, and expiration
 * @returns Presigned upload URL (default expiration: 15 minutes)
 */
export async function put(
    key: string,
    options?: PutPresignOptions
): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options?.contentType,
        ContentLength: options?.contentLength,
    });
    return getSignedUrl(client, command, {
        expiresIn: options?.expiresIn ?? 900,
    });
}

/**
 * A `Content-Disposition` that names the saved file, with backslashes and
 * quotes escaped so a filename can't break out of the quoted string.
 *
 * Exported because every bucket the app presigns reads from needs the same
 * sanitisation, and a second copy is a second place to forget it (#426).
 */
export function contentDisposition(filename?: string): string | undefined {
    if (!filename) return undefined;
    const escaped = filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `attachment; filename="${escaped}"`;
}

/**
 * Generate a presigned URL for downloading an object
 * @param key - S3 object key
 * @param options - Optional expiration and download filename
 * @returns Presigned download URL (default expiration: 1 hour)
 */
export async function get(
    key: string,
    options?: GetPresignOptions
): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(options?.filename),
    });
    return getSignedUrl(client, command, {
        expiresIn: options?.expiresIn ?? 3600,
    });
}

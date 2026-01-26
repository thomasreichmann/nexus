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
 * Generate a presigned URL for downloading an object
 * @param key - S3 object key
 * @param options - Optional expiration and download filename
 * @returns Presigned download URL (default expiration: 1 hour)
 */
export async function get(
    key: string,
    options?: GetPresignOptions
): Promise<string> {
    // Sanitize filename for Content-Disposition header (escape backslashes and quotes)
    const disposition = options?.filename
        ? `attachment; filename="${options.filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : undefined;

    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: disposition,
    });
    return getSignedUrl(client, command, {
        expiresIn: options?.expiresIn ?? 3600,
    });
}

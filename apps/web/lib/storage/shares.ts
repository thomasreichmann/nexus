import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { client } from './client';
import { getSharesDistribution, signGet } from './cloudfront';
import { contentDisposition } from './presigned';

/**
 * The shares bucket: files behind the public 24-hour links. Same client and
 * credentials as the files bucket, a different bucket, because nothing about
 * the files bucket suits them. It archives to Deep Archive on a lifecycle run
 * and keeps deleted versions for 30 days; this one is Standard class,
 * unversioned, and its lifecycle rule deletes every object a day after upload
 * (`infra/terraform/s3.tf`).
 *
 * The bucket is optional env (rollout ordering, see lib/env/schema.ts):
 * callers must check isConfigured() and refuse to create shares without it.
 */

export function isConfigured(): boolean {
    return Boolean(env.S3_SHARES_BUCKET);
}

function requireBucket(): string {
    if (!env.S3_SHARES_BUCKET) {
        throw new Error(
            'S3_SHARES_BUCKET is not set — gate calls with shares.isConfigured()'
        );
    }
    return env.S3_SHARES_BUCKET;
}

/**
 * Presigned PUT for one shared file. `contentLength` is required, not
 * optional as on `presigned.put`: it is a signed header, so S3 rejects a body
 * of any other size, and that is what holds an anonymous uploader to the size
 * they declared. The content type is left unsigned. Downloads are always
 * attachments, so whatever type the browser sends changes nothing.
 */
export async function put(
    key: string,
    options: { contentLength: number; expiresIn: number }
): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        ContentLength: options.contentLength,
    });
    return getSignedUrl(client, command, { expiresIn: options.expiresIn });
}

/**
 * Signed download URL. Always an attachment under `filename`, so an uploaded
 * HTML or SVG file is saved, never rendered. Through the shares bucket's
 * CloudFront distribution when one is configured, like `presigned.get`.
 */
export async function get(
    key: string,
    options: { filename: string; expiresIn: number }
): Promise<string> {
    const disposition = contentDisposition(options.filename);

    const distribution = getSharesDistribution();
    if (distribution) {
        return signGet(distribution, key, {
            expiresIn: options.expiresIn,
            contentDisposition: disposition,
        });
    }

    const command = new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        ResponseContentDisposition: disposition,
    });
    return getSignedUrl(client, command, { expiresIn: options.expiresIn });
}

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { client } from './client';
import { contentDisposition } from './presigned';
import type { GetPresignOptions } from './types';

/**
 * Presigned reads against the retrieval-artifacts (zip) bucket. Same client and
 * credentials as the files bucket — only the bucket differs, exactly like
 * `derived`. The bucket is optional env (rollout ordering, see
 * lib/env/schema.ts): callers must check isConfigured() and hide the download
 * surface when it's absent.
 *
 * Read-only on purpose. The zip worker writes these objects and S3's lifecycle
 * rule deletes them; the app's IAM user is granted `s3:GetObject` and nothing
 * else on this bucket (`infra/terraform/iam.tf`).
 */

export function isConfigured(): boolean {
    return Boolean(env.S3_RETRIEVAL_ARTIFACTS_BUCKET);
}

export async function get(
    key: string,
    options?: GetPresignOptions
): Promise<string> {
    if (!env.S3_RETRIEVAL_ARTIFACTS_BUCKET) {
        throw new Error(
            'S3_RETRIEVAL_ARTIFACTS_BUCKET is not set — gate calls with artifacts.isConfigured()'
        );
    }
    const command = new GetObjectCommand({
        Bucket: env.S3_RETRIEVAL_ARTIFACTS_BUCKET,
        Key: key,
        // Without a filename the browser saves the object key's UUID path; the
        // reader wants "nexus-part-1.zip".
        ResponseContentDisposition: contentDisposition(options?.filename),
    });
    return getSignedUrl(client, command, {
        expiresIn: options?.expiresIn ?? 3600,
    });
}

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { client } from './client';

/**
 * Presigned reads against the derived (thumbnails) bucket. Same client and
 * credentials as the files bucket — only the bucket differs. The bucket is
 * optional env (rollout ordering, see lib/env/schema.ts): callers must
 * check isConfigured() and degrade to icon fallbacks when it's absent.
 */

export function isConfigured(): boolean {
    return Boolean(env.S3_DERIVED_BUCKET);
}

export async function get(
    key: string,
    options?: { expiresIn?: number }
): Promise<string> {
    if (!env.S3_DERIVED_BUCKET) {
        throw new Error(
            'S3_DERIVED_BUCKET is not set — gate calls with derived.isConfigured()'
        );
    }
    const command = new GetObjectCommand({
        Bucket: env.S3_DERIVED_BUCKET,
        Key: key,
    });
    return getSignedUrl(client, command, {
        expiresIn: options?.expiresIn ?? 3600,
    });
}

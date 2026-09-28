import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

function requireBucket(): string {
    if (!env.S3_DERIVED_BUCKET) {
        throw new Error(
            'S3_DERIVED_BUCKET is not set — gate calls with derived.isConfigured()'
        );
    }
    return env.S3_DERIVED_BUCKET;
}

export async function get(
    key: string,
    options?: { expiresIn?: number }
): Promise<string> {
    const command = new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
    });
    return getSignedUrl(client, command, {
        expiresIn: options?.expiresIn ?? 3600,
    });
}

/**
 * Read an existing object's metadata with the app's own credentials — the
 * one round trip that proves the presigned URLs `get` mints will actually
 * resolve. `get` can't tell: presigning is local HMAC and succeeds against a
 * bucket that doesn't exist. Throws the AWS error on any failure.
 *
 * Pass a key that exists. The app's IAM grant here is GetObject only (no
 * ListBucket), so S3 answers 403 for a missing key and a denied one alike.
 */
export async function probe(key: string): Promise<void> {
    await client.send(
        new HeadObjectCommand({ Bucket: requireBucket(), Key: key })
    );
}

import {
    CopyObjectCommand,
    HeadObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

export interface TestS3 {
    client: S3Client;
    bucket: string;
}

/**
 * Builds a real S3 client against the current env's bucket (dev unless
 * `.env.local` says otherwise) for tests and forensics scripts that must
 * observe actual object state — tier, existence, restore status. Unit-test
 * fakes live in `lib/storage/testing.ts`; this is the opposite: nothing is
 * mocked. Config mirrors `lib/storage/client.ts` without the `@/lib/env`
 * dependency, so it also works from standalone tsx scripts.
 */
export function createTestS3(): TestS3 {
    const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET } =
        process.env;
    if (
        !AWS_REGION ||
        !AWS_ACCESS_KEY_ID ||
        !AWS_SECRET_ACCESS_KEY ||
        !S3_BUCKET
    ) {
        throw new Error(
            'Missing AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET — check apps/web/.env.local (pnpm env:pull).'
        );
    }
    return {
        client: new S3Client({
            region: AWS_REGION,
            credentials: {
                accessKeyId: AWS_ACCESS_KEY_ID,
                secretAccessKey: AWS_SECRET_ACCESS_KEY,
            },
            requestChecksumCalculation: 'WHEN_REQUIRED',
        }),
        bucket: S3_BUCKET,
    };
}

export type S3StorageClass = 'STANDARD' | 'GLACIER' | 'DEEP_ARCHIVE';

/**
 * Moves an object to another storage tier by copying it onto itself with a
 * new StorageClass — the same transition the bucket's lifecycle rules make,
 * without the multi-day wait. Only works COLDER from a readable object
 * (STANDARD → GLACIER/DEEP_ARCHIVE): S3 refuses to copy FROM an archived
 * object until it has been restored.
 */
export async function moveToTier(
    s3: TestS3,
    key: string,
    storageClass: S3StorageClass
): Promise<void> {
    await s3.client.send(
        new CopyObjectCommand({
            Bucket: s3.bucket,
            Key: key,
            // CopySource is a URI: encode each segment, keep the slashes.
            CopySource: `${s3.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
            StorageClass: storageClass,
            MetadataDirective: 'COPY',
        })
    );
}

/**
 * Reads an object's storage class via HeadObject. AWS omits the field for
 * STANDARD objects; normalized here so callers always get a value.
 */
export async function getStorageClass(
    s3: TestS3,
    key: string
): Promise<string> {
    const head = await s3.client.send(
        new HeadObjectCommand({ Bucket: s3.bucket, Key: key })
    );
    return head.StorageClass ?? 'STANDARD';
}

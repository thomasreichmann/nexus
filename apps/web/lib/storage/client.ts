import { S3Client } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';

export const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    // Presigned URLs for browser uploads can't satisfy SDK v3's default CRC32 checksum
    requestChecksumCalculation: 'WHEN_REQUIRED',
});

export const bucket = env.S3_BUCKET;

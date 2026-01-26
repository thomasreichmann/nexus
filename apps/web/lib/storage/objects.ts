import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { client, bucket } from './client';

/**
 * Delete an object from the bucket
 * Idempotent: returns successfully even if the object doesn't exist
 * @param key - S3 object key to delete
 */
export async function remove(key: string): Promise<void> {
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await client.send(command);
}

import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

export interface ObjectSummary {
    key: string;
    size?: number;
    storageClass?: string;
}

/**
 * List every object in the bucket with its storage class, paging through
 * results (S3 caps a single response at 1000 keys)
 */
export async function listAll(): Promise<ObjectSummary[]> {
    const objects: ObjectSummary[] = [];
    let continuationToken: string | undefined;

    do {
        const response = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                ContinuationToken: continuationToken,
            })
        );
        for (const object of response.Contents ?? []) {
            if (!object.Key) continue;
            objects.push({
                key: object.Key,
                size: object.Size,
                storageClass: object.StorageClass,
            });
        }
        continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return objects;
}

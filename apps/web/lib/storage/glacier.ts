import { RestoreObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { interpretObjectState } from '@nexus/db/object-state';
import { client, bucket } from './client';
import { DEFAULT_RESTORE_DAYS_TO_KEEP } from './types';
import type { RestoreTier, ObjectState } from './types';

const tierMapping: Record<RestoreTier, 'Expedited' | 'Standard' | 'Bulk'> = {
    expedited: 'Expedited',
    standard: 'Standard',
    bulk: 'Bulk',
};

/**
 * Start a restore operation for an object in Glacier Deep Archive
 * @param key - S3 object key
 * @param tier - Restore speed: 'expedited' (1-5min), 'standard' (3-5h), or 'bulk' (5-12h)
 * @param daysToKeep - Days to keep the restored copy accessible (default: 7)
 */
export async function restore(
    key: string,
    tier: RestoreTier,
    daysToKeep = DEFAULT_RESTORE_DAYS_TO_KEEP
): Promise<void> {
    const command = new RestoreObjectCommand({
        Bucket: bucket,
        Key: key,
        RestoreRequest: {
            Days: daysToKeep,
            GlacierJobParameters: { Tier: tierMapping[tier] },
        },
    });
    await client.send(command);
}

/**
 * Ask S3 what an object can do right now — one HeadObject, both answers.
 *
 * S3 owns object state (see `docs/ai/context.md`); this is how we read it at
 * the moment it matters, instead of trusting a column that mirrors it. Cheap
 * enough to call per action: HEAD bills as a GET-class request ($0.0004 per
 * 1,000) and is metadata-only, so it costs the same for a Deep Archive object
 * as for a warm one and never triggers a retrieval.
 *
 * @param key - S3 object key
 * @throws If the object doesn't exist
 */
export async function getObjectState(key: string): Promise<ObjectState> {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);

    return interpretObjectState({
        storageClass: response.StorageClass,
        restoreHeader: response.Restore,
    });
}

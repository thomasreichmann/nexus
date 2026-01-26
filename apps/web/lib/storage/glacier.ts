import { RestoreObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { client, bucket } from './client';
import type { RestoreTier, RestoreStatus } from './types';

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
    daysToKeep = 7
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
 * Check the restore status of a Glacier object
 * @param key - S3 object key
 * @returns Status object with restore state and expiration (if completed)
 * @throws If the object doesn't exist
 */
export async function checkStatus(key: string): Promise<RestoreStatus> {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);

    const restoreHeader = response.Restore;
    if (!restoreHeader) {
        return { status: 'not-started' };
    }

    if (restoreHeader.includes('ongoing-request="true"')) {
        return { status: 'in-progress' };
    }

    // Parse expiry-date from: ongoing-request="false", expiry-date="..."
    const expiryMatch = restoreHeader.match(/expiry-date="([^"]+)"/);
    return {
        status: 'completed',
        expiresAt: expiryMatch ? new Date(expiryMatch[1]) : undefined,
    };
}

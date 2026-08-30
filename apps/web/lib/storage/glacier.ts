import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { interpretObjectState } from '@nexus/db/objectState';
import { client, bucket } from './client';
import type { ObjectState } from './types';

// No `restore` here: `RestoreObject` is the worker's to issue (#423). The app
// decides *that* a restore happens — it writes the rows and publishes the job —
// and the `initiate-restore` handler is the single place that tells AWS. A
// wrapper on this side would be an unused second way to start one.

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

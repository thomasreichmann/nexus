import * as presigned from './presigned';
import * as glacier from './glacier';
import * as objects from './objects';

/**
 * S3 storage operations for file archival
 *
 * @example
 * ```typescript
 * import { s3 } from '@/lib/storage';
 *
 * // Generate presigned URLs
 * const uploadUrl = await s3.presigned.put(key, { contentType: 'image/png' });
 * const downloadUrl = await s3.presigned.get(key, { filename: 'download.png' });
 *
 * // Glacier operations
 * await s3.glacier.restore(key, 'standard');
 * const status = await s3.glacier.checkStatus(key);
 *
 * // Object operations
 * await s3.objects.remove(key);
 * ```
 */
export const s3 = {
    presigned,
    glacier,
    objects,
} as const;

// Re-export types for convenience
export type {
    RestoreTier,
    RestoreStatus,
    PutPresignOptions,
    GetPresignOptions,
} from './types';

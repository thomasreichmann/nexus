import { put as presignedPut, get as presignedGet } from './presigned';
import {
    restore as glacierRestore,
    restoreMany as glacierRestoreMany,
    checkStatus as glacierCheckStatus,
} from './glacier';
import { remove as objectsRemove, listAll as objectsListAll } from './objects';
import {
    create as multipartCreate,
    signParts as multipartSignParts,
    signPartsByNumber as multipartSignPartsByNumber,
    listParts as multipartListParts,
    complete as multipartComplete,
    abort as multipartAbort,
} from './multipart';

const presigned = {
    put: presignedPut,
    get: presignedGet,
} as const;

const glacier = {
    restore: glacierRestore,
    restoreMany: glacierRestoreMany,
    checkStatus: glacierCheckStatus,
} as const;

const objects = {
    remove: objectsRemove,
    listAll: objectsListAll,
} as const;

const multipart = {
    create: multipartCreate,
    signParts: multipartSignParts,
    signPartsByNumber: multipartSignPartsByNumber,
    listParts: multipartListParts,
    complete: multipartComplete,
    abort: multipartAbort,
} as const;

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
    multipart,
} as const;

// Re-export types for convenience
export type {
    RestoreTier,
    RestoreStatus,
    PutPresignOptions,
    GetPresignOptions,
} from './types';

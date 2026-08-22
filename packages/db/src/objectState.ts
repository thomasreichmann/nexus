import { DEFAULT_RESTORE_DAYS_TO_KEEP } from './schema/storage';

/**
 * What we are allowed to believe about an S3 object.
 *
 * S3 owns object state (see `docs/ai/context.md`). Nothing in the DB records
 * an object's storage class, so every answer here is either read from S3 at
 * the moment it matters (`interpretObjectState`) or openly labelled a guess
 * (`isProbablyCold`).
 *
 * Lives in `@nexus/db` rather than in `apps/web` because the worker's
 * retrieval poll needs the same reading of the same headers, and it can't
 * import from the app (#364). Only the transport differs between the two —
 * the policy is here, once.
 */

/**
 * What an object can actually do right now, as S3 reports it.
 *
 * - `warm` — readable directly; no restore needed or possible.
 * - `archived` — in Glacier or Deep Archive with no restore requested.
 * - `restoring` — a restore is in flight; not yet readable.
 * - `restored` — archived, but a temporary readable copy exists.
 */
export type ObjectAvailability = 'warm' | 'archived' | 'restoring' | 'restored';

export interface ObjectState {
    availability: ObjectAvailability;
    /** Raw S3 `StorageClass`. Absent for STANDARD — S3 omits the header. */
    storageClass?: string;
    /** When the restored copy lapses. Only ever set for `restored`. */
    expiresAt?: Date;
}

/** Classes that need a RestoreObject before the bytes can be read. */
const ARCHIVED_CLASSES = new Set(['GLACIER', 'DEEP_ARCHIVE']);

/** The `StorageClass` and `x-amz-restore` headers of a HeadObject response. */
export interface ObjectHeaders {
    storageClass?: string;
    restoreHeader?: string;
}

/**
 * Read a HeadObject response into an availability answer.
 *
 * Pure, so both callers (`apps/web`'s storage module and the worker's poll)
 * get identical semantics from their own S3 clients, and so it can be tested
 * without AWS.
 */
export function interpretObjectState({
    storageClass,
    restoreHeader,
}: ObjectHeaders): ObjectState {
    // S3 omits StorageClass entirely for STANDARD, so absent means warm.
    if (!storageClass || !ARCHIVED_CLASSES.has(storageClass)) {
        return { availability: 'warm', storageClass };
    }

    if (!restoreHeader) {
        return { availability: 'archived', storageClass };
    }

    if (restoreHeader.includes('ongoing-request="true"')) {
        return { availability: 'restoring', storageClass };
    }

    // Parse expiry-date from: ongoing-request="false", expiry-date="..."
    const expiryMatch = restoreHeader.match(/expiry-date="([^"]+)"/);
    return {
        availability: 'restored',
        storageClass,
        expiresAt: expiryMatch ? new Date(expiryMatch[1]) : undefined,
    };
}

/**
 * End of the download window for a copy that is readable but has no S3 expiry
 * of its own — a warm object, or a restore whose header carried no
 * `expiry-date`. Keeps the request path and the poll quoting one window.
 */
export function restoreWindowEnd(from: Date = new Date()): Date {
    return new Date(
        from.getTime() + DEFAULT_RESTORE_DAYS_TO_KEEP * 24 * 60 * 60 * 1000
    );
}

/** Whether S3 will serve this object's bytes right now, without a restore. */
export function isReadable(state: ObjectState): boolean {
    return state.availability === 'warm' || state.availability === 'restored';
}

/**
 * Objects at or below this size never transition: it is S3's implicit minimum
 * for a lifecycle transition, made explicit in the bucket rule's
 * `object_size_greater_than` (`infra/terraform/s3.tf`). Deep Archive's minimum
 * billable size would make a sub-128KB object cost more cold than warm.
 */
export const LIFECYCLE_TRANSITION_MIN_BYTES = 131072;

/**
 * How long after upload the (~daily) lifecycle run has reliably swept an
 * object into Deep Archive. The rule itself says `days = 0`, but S3 batches
 * the work, so a fresh object stays warm for a while yet.
 */
export const LIFECYCLE_TRANSITION_LAG_HOURS = 48;

/**
 * A coarse guess at whether an object has been swept into Deep Archive,
 * derived from the bucket's lifecycle policy rather than from S3 itself.
 *
 * This is a policy expectation, not a claim, and it is allowed to be wrong for
 * any given file. Use it to set expectations in the UI — never to decide
 * whether a restore is needed. That question goes to S3, via
 * `interpretObjectState`.
 */
export function isProbablyCold(file: {
    size: number;
    createdAt: Date;
}): boolean {
    if (file.size <= LIFECYCLE_TRANSITION_MIN_BYTES) return false;
    const ageHours = (Date.now() - file.createdAt.getTime()) / 3_600_000;
    return ageHours >= LIFECYCLE_TRANSITION_LAG_HOURS;
}

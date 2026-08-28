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
 *
 * **This module imports nothing, and that is load-bearing.** Client
 * components call `isProbablyCold` per row, so anything reachable from here
 * ships to the browser. It used to reach `./schema/storage` for one number,
 * which dragged all of drizzle and every table definition into the
 * `/dashboard/files` bundle — the table names were greppable in the built
 * chunk. The retrieval-policy constants below therefore live here and the
 * schema imports *them*, not the other way round.
 */

/**
 * Glacier restore tier values — determines retrieval speed and cost.
 *
 * For Deep Archive (MVP default):
 * - expedited: Not available for Deep Archive
 * - standard: 12-48 hours
 * - bulk: 48 hours (cheapest)
 *
 * For Glacier Flexible Retrieval:
 * - expedited: 1-5 minutes (most expensive)
 * - standard: 3-5 hours
 * - bulk: 5-12 hours
 */
export const RESTORE_TIERS = ['standard', 'bulk', 'expedited'] as const;
export type RestoreTier = (typeof RESTORE_TIERS)[number];

/**
 * Days a restored Glacier copy stays accessible, when that copy is what the
 * user downloads — a single-file restore. Also the length of the synthetic
 * download window for an object that was already warm, which skips S3 restore
 * entirely: keep the two in lockstep so both present the same window.
 *
 * A multi-file restore is delivered as a zip instead and uses
 * `ZIP_BUILD_RESTORE_DAYS`.
 */
export const DEFAULT_RESTORE_DAYS_TO_KEEP = 7;

/**
 * Whether a restore of this many files is delivered as zip artifacts rather
 * than as a direct download of the restored copy (#406).
 *
 * The whole zip pipeline hangs off this one predicate, and two halves that
 * cannot see each other both need it: the request path, to decide which restore
 * window to buy, and the worker poll, to decide which requests to build. A
 * second copy of `length > 1` in either place is a single-file restore that
 * either pays for a zip nobody downloads or promises one that never arrives.
 */
export function isDeliveredAsZip(fileCount: number): boolean {
    return fileCount >= ZIP_DELIVERY_MIN_FILES;
}

/**
 * The threshold behind `isDeliveredAsZip`, exported separately because the
 * worker's buildable-request scan has to express the same rule in SQL, where a
 * TypeScript predicate cannot reach.
 */
export const ZIP_DELIVERY_MIN_FILES = 2;

/**
 * Days a restored copy stays accessible when the restore only exists to feed a
 * zip build (#424).
 *
 * A multi-file restore is delivered as zip artifacts, and the artifacts' own
 * lifecycle rule owns how long the user can download them
 * (`infra/terraform/s3.tf`). The thawed originals behind them are machinery:
 * they only have to outlive the build, which the poll starts within 15 minutes
 * of the last file thawing and which finishes in minutes. Deep Archive charges
 * for the restored copy for the whole window, so the seven days the direct
 * download path needs are seven days of double storage nobody reads here.
 *
 * Two rather than one because it is a redrive budget, not a build budget: a zip
 * job that exhausts its SQS attempts parks on the DLQ, and the depth alarm has
 * to reach a human who can redrive it before the originals lapse and the
 * rebuild has nothing to read.
 */
export const ZIP_BUILD_RESTORE_DAYS = 2;

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
 * Whether a failed HeadObject means the object is gone rather than that the
 * request itself failed.
 *
 * The distinction is the one both callers act on: a vanished object is a
 * settled answer — a 404 to the user, a `failed` retrieval for the poll —
 * while anything else is a transient we retry. S3 answers a missing key with
 * `NotFound` and a denied one with 403, so a lost IAM role never reads as a
 * lost object.
 *
 * Duck-typed rather than `instanceof NotFound` so this module keeps importing
 * nothing (see the file docblock) and so it survives the two S3 clients in
 * play — the app's and the worker's — being separate SDK instances.
 */
export function isObjectMissing(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { name, $metadata } = error as {
        name?: unknown;
        $metadata?: { httpStatusCode?: number };
    };
    return (
        name === 'NotFound' ||
        name === 'NoSuchKey' ||
        $metadata?.httpStatusCode === 404
    );
}

/**
 * End of the download window for a copy that is readable but has no S3 expiry
 * of its own — a warm object, or a restore whose header carried no
 * `expiry-date`. Keeps the request path and the poll quoting one window.
 */
export function restoreWindowEnd(
    from: Date = new Date(),
    days: number = DEFAULT_RESTORE_DAYS_TO_KEEP
): Date {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
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

/**
 * Tuning constants for the upload engines.
 *
 * They live outside the hook so tests can assert against the real numbers
 * rather than copies: a quota test that hard-codes its own idea of the
 * in-flight byte ceiling can't catch that ceiling being raised.
 */

/** Above this size an upload goes through the multipart engine. */
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB

/** Per-file ceiling on concurrent part PUTs within one multipart upload. */
export const MAX_CONCURRENT_CHUNKS = 3;

export const MAX_CHUNK_RETRIES = 3;
export const CONFIRM_RETRIES = 3;

/**
 * How many files move at once. Roughly 370ms of every upload is fixed API
 * overhead (presign + confirm) that no amount of bandwidth shortens, so a queue
 * of small files is latency-bound and gains almost linearly here (#340).
 */
export const MAX_CONCURRENT_FILES = 4;

/**
 * Every browser→S3 PUT draws from this budget, single-part and multipart alike:
 * 6 is the browser's per-host connection cap, so anything above it queues in
 * the socket pool where we can't see it. Keeping `MAX_CONCURRENT_FILES` at or
 * below the budget is what guarantees liveness — each file needs one permit to
 * make progress, and it never holds one while waiting for another.
 */
export const S3_CONNECTION_BUDGET = 6;

/**
 * Ceiling on summed in-flight bytes. Concurrent uploads all pass the server's
 * quota pre-check against the same committed baseline, and `SOFT_LIMIT_MULTIPLIER`
 * (`@nexus/db/plans`) accepts a 5% overshoot — ~51 GiB on the smallest plan.
 * This keeps the burst well inside that band. Photo workloads never come near
 * it; it exists for videographer-scale files.
 */
export const MAX_IN_FLIGHT_BYTES = 32 * 1024 ** 3; // 32 GiB

/**
 * Ceiling on files one gesture (a drop or a folder pick) may add to the queue.
 * It exists to stop an accidental home-folder drop from grinding through the
 * whole disk, not to size a shoot: the ICP reference library is 8,934 files
 * across six shoot folders, the natural gesture is dropping the parent, and
 * the old 5,000 quietly kept 56% of it (#402). Hitting this is a blocking
 * choice, never a silent trim, and the queue itself survives far more (#390).
 * Sized so a whole library fits with room to grow while a home folder still
 * stops within seconds (~11k files/s measured on the reference library).
 */
export const MAX_FILES_PER_DROP = 50_000;

/**
 * Input cap of `files.findDuplicates`, and the chunk size the queue's vault
 * check (#401) splits a gesture into. Deliberately not `MAX_FILES_PER_DROP`:
 * that one bounds a directory walk and is free to grow, while this one is
 * bounded by the wire. A chunk has to fit Vercel's 4.5 MB request body (a
 * worst-case 255-char CJK name is ~800 bytes, so ~4 MB here) and its distinct
 * names become one IN list, well inside Postgres's 65,535 bind parameters.
 * A bigger drop just costs more round trips.
 */
export const MAX_FILES_PER_VAULT_LOOKUP = 5000;

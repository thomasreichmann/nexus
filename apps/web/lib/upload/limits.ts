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

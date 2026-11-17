/**
 * The numbers behind the public share links. Client and server read the same
 * constants: the page refuses a selection the server would refuse, and its
 * copy can't drift from what is enforced.
 */

const GIB = 1024 ** 3;
const HOUR_MS = 60 * 60 * 1000;

/** How long a link works, counted from the moment it is created. */
export const SHARE_TTL_MS = 24 * HOUR_MS;

/**
 * Ceiling on one link's files, summed. Each file is a single presigned PUT,
 * and 5 GiB is also the most S3 takes in one PUT, so the per-link cap doubles
 * as the per-file one.
 */
export const MAX_SHARE_BYTES = 5 * GIB;

export const MAX_SHARE_FILES = 50;

/**
 * Lifetime of each upload URL. All of a link's URLs are minted at once and
 * the files go up a few at a time, so the last one has to outlive the whole
 * upload: 5 GiB at 2 Mbit/s is about six hours.
 */
export const SHARE_UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60;

/**
 * Download URLs one shared file may be issued over the link's life. Far more
 * than a link passed around by hand will see; it exists so a link that goes
 * viral, or gets scripted, stops costing egress at some point: at most 100
 * copies of a link's bytes, 500 GiB for a full-size one.
 */
export const MAX_DOWNLOADS_PER_SHARED_FILE = 100;

/** The window the creation limits below are counted over. */
export const SHARE_RATE_WINDOW_MS = 24 * HOUR_MS;

/** Links one IP address may create per window. */
export const MAX_SHARES_PER_IP = 10;

/** Bytes one IP address may declare per window: two full-size links. */
export const MAX_SHARE_BYTES_PER_IP = 2 * MAX_SHARE_BYTES;

/**
 * Bytes everyone together may declare per window. A circuit breaker on the
 * AWS bill, not a product limit: objects live a day or two, so this bounds
 * what the bucket can hold at around 200 GiB, a few dollars a month at the
 * Standard rate.
 */
export const MAX_SHARE_BYTES_GLOBAL = 100 * GIB;

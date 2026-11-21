/**
 * The file browser's page sizes (#455), stated once for the router that caps
 * them and the client that asks for them: raise one alone and every page
 * request fails validation.
 */

/** Batch cards per page of the library. */
export const BATCH_PAGE_SIZE = 12;

/**
 * Files per page of an open batch. Also the `getThumbnailUrls` input cap, so
 * a page's thumbnails are one request.
 */
export const FILE_PAGE_SIZE = 100;

/**
 * How long a search box waits after the last keystroke before it asks the
 * server: the library's and the Move to… dialog's (#453), so both feel the
 * same.
 */
export const SEARCH_DEBOUNCE_MS = 300;

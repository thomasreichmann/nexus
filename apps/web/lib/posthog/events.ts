/**
 * Product event names, shared by the browser and the Node SDK so a rename
 * can't split one funnel into two. Autocapture covers clicks and pageviews;
 * these are the steps that either span a network round-trip or only the
 * server can confirm, which autocapture can't see.
 */
export const PostHogEvent = {
    /** Account created (client-confirmed, before the post-signup redirect). */
    SignedUp: 'signed_up',
    /**
     * Bytes started moving browser→S3. Per attempt, not per upload — filter
     * on `isResume` for a started→completed funnel.
     */
    UploadStarted: 'upload_started',
    /** Browser saw the upload through to confirm. */
    UploadCompleted: 'upload_completed',
    /** Terminal upload failure — excludes pauses, aborts, and offline drops. */
    UploadFailed: 'upload_failed',
    /** Server flipped the file to `available` and counted its bytes. */
    UploadConfirmed: 'upload_confirmed',
    /** User asked for a Glacier restore (single file or bulk selection). */
    RetrievalRequested: 'retrieval_requested',
    /** S3 reported the restore complete — hours later, no session attached. */
    RetrievalReady: 'retrieval_ready',
    /** User opened a download URL. */
    FileDownloaded: 'file_downloaded',
} as const;

export type PostHogEventName = (typeof PostHogEvent)[keyof typeof PostHogEvent];

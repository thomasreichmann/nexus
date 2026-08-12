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
     * Bytes started moving browser→S3. Per attempt, not per upload — filter on
     * `isRetry` for a started→completed funnel, and join attempts to their
     * outcome on `clientUploadId`. Mirror this caveat into the event's
     * description in PostHog data management: that's where analyses get built,
     * and a note only in the source won't reach them.
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

/**
 * Property carrying the Vercel tier that emitted an event, shared for the same
 * reason as the names above. Preview deploys report to the same project as
 * production, so without this every funnel silently counts the deploys we poke
 * at while reviewing a PR, and nothing distinguishes those from a real user.
 *
 * The value comes from a different env var on each side — the browser needs
 * the literal `process.env.NEXT_PUBLIC_*` expression to survive bundling,
 * while the server reads the unprefixed one — so only the key is shared.
 *
 * PostHog's "filter out internal and test users" toggle is configured against
 * this property (project settings), which is what keeps insights on production
 * by default rather than making every analysis remember to filter.
 */
export const ANALYTICS_ENVIRONMENT_PROPERTY = 'environment';

/**
 * Name of the survey behind the "Send feedback" menu item, matched at click
 * time. The lookup returns every live survey in the project, so picking the
 * first would quietly hand the button to an unrelated campaign the moment a
 * second survey is switched on in the PostHog UI.
 *
 * This makes the name load-bearing: rewrite the survey's questions freely, but
 * renaming it in PostHog disables the button (it falls back to the
 * "unavailable" toast) until this constant follows.
 */
export const FEEDBACK_SURVEY_NAME = 'Alpha feedback';

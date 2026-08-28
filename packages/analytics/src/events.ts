/**
 * Product event names, shared by the browser, the app's Node runtime, and the
 * worker Lambda so a rename can't split one funnel into two. Autocapture
 * covers clicks and pageviews; these are the steps that either span a network
 * round-trip or only a server can confirm, which autocapture can't see.
 *
 * They live in a package rather than in apps/web because the worker cannot
 * import from the app (the @nexus/db precedent, #364) — and the worker owns
 * the one event no session is attached to.
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
 * Property carrying the environment that emitted an event, shared for the same
 * reason as the names above. Preview deploys report to the same project as
 * production, so without this every funnel silently counts the deploys we poke
 * at while reviewing a PR, and nothing distinguishes those from a real user.
 *
 * The value comes from a different env var on every runtime — the browser
 * needs the literal `process.env.NEXT_PUBLIC_*` expression to survive
 * bundling, the app's server side reads the unprefixed one, and the worker
 * Lambda gets a Terraform literal — so only the key is shared. Each caller
 * resolves the value and hands it to `createServerAnalytics`.
 *
 * PostHog's "filter out internal and test users" toggle is configured against
 * this property (project settings), which is what keeps insights on production
 * by default rather than making every analysis remember to filter.
 */
export const ANALYTICS_ENVIRONMENT_PROPERTY = 'environment';

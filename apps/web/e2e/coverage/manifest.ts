/**
 * E2E coverage manifest — the definition of "100% coverage" for Playwright
 * E2E tests. Every page and user-facing use-case in the app is listed here.
 *
 * Tests declare what they cover via Playwright tags:
 *   - `@page:<route>`  — the test exercises this page
 *   - `@uc:<id>`       — the test covers this use-case
 *
 * `pnpm -F web e2e:coverage` cross-references these tags against this
 * manifest and writes `coverage/e2e-coverage.json`, which the /dev/coverage
 * dashboard renders.
 *
 * Items with `excluded` are intentionally out of E2E scope (with the reason
 * documented) and don't count against the 100% target — they're still shown
 * on the dashboard so the exclusion is a visible, deliberate decision.
 *
 * When you ship a new page or user-facing flow, add it here first; the
 * coverage report fails `--check` until a tagged test exists.
 */

export type PageAuth = 'public' | 'user' | 'admin';

export interface PageEntry {
    /** Route path, also used in tags as `@page:<route>` */
    route: string;
    title: string;
    auth: PageAuth;
}

export type Area =
    | 'auth'
    | 'dashboard'
    | 'files'
    | 'upload'
    | 'billing'
    | 'settings'
    | 'admin-jobs'
    | 'admin-dev-tools'
    | 'errors'
    | 'navigation'
    | 'dev-pages';

export interface UseCaseEntry {
    /** Kebab-case id, also used in tags as `@uc:<id>` */
    id: string;
    title: string;
    area: Area;
    routes: string[];
    /** Reason this use-case is intentionally out of E2E scope */
    excluded?: string;
    /**
     * Reason this use-case is only verified by the manual `validate` tier
     * (never run in CI / `pnpm check`). The coverage check fails if a
     * use-case is validate-only without this acknowledgment, so "covered"
     * can't silently mean "covered by a test that never runs".
     */
    manual?: string;
}

export const PAGES: PageEntry[] = [
    { route: '/', title: 'Landing', auth: 'public' },
    { route: '/sign-in', title: 'Sign in', auth: 'public' },
    { route: '/sign-up', title: 'Sign up', auth: 'public' },
    { route: '/dashboard', title: 'Dashboard overview', auth: 'user' },
    { route: '/dashboard/files', title: 'Files', auth: 'user' },
    { route: '/dashboard/upload', title: 'Upload', auth: 'user' },
    { route: '/dashboard/settings', title: 'Settings', auth: 'user' },
    { route: '/dashboard/admin/jobs', title: 'Admin · Jobs', auth: 'admin' },
    {
        route: '/dashboard/admin/dev-tools',
        title: 'Admin · Dev tools',
        auth: 'admin',
    },
    { route: '/design', title: 'Design system', auth: 'public' },
    { route: '/dev/coverage', title: 'Dev · Coverage', auth: 'public' },
    { route: '/dev/studio', title: 'Dev · tRPC Studio', auth: 'public' },
    { route: '/dev/report', title: 'Dev · Coverage report', auth: 'public' },
];

export const USE_CASES: UseCaseEntry[] = [
    /* ---------------------------------------------------------------- */
    /* Auth                                                              */
    /* ---------------------------------------------------------------- */
    {
        id: 'sign-up-email',
        title: 'Sign up with email/password and land on dashboard',
        area: 'auth',
        routes: ['/sign-up'],
    },
    {
        id: 'trial-on-signup',
        title: 'Trial subscription is provisioned at signup',
        area: 'auth',
        routes: ['/sign-up', '/dashboard/settings'],
    },
    {
        id: 'sign-in-email',
        title: 'Sign in with valid credentials',
        area: 'auth',
        routes: ['/sign-in'],
    },
    {
        id: 'sign-in-invalid-credentials',
        title: 'Sign in with wrong password shows an error',
        area: 'auth',
        routes: ['/sign-in'],
    },
    {
        id: 'sign-out',
        title: 'Sign out from the user menu',
        area: 'auth',
        routes: ['/dashboard'],
    },
    {
        id: 'auth-guard-admin',
        title: 'Unauthenticated and non-admin visitors to admin pages are redirected',
        area: 'auth',
        routes: ['/dashboard/admin/jobs'],
    },
    {
        id: 'auth-guard-dashboard',
        title: 'Signed-out visitors to dashboard routes are redirected to sign-in with the original path preserved',
        area: 'auth',
        routes: ['/dashboard/files', '/sign-in'],
    },
    {
        id: 'auth-guard-deep-link-round-trip',
        title: 'Signing in from a preserved deep-link lands back on the original URL',
        area: 'auth',
        routes: ['/sign-in', '/dashboard/files'],
    },
    {
        id: 'auth-guard-signed-in-redirect',
        title: 'Signed-in visitors to /sign-in or /sign-up are forwarded to the dashboard',
        area: 'auth',
        routes: ['/sign-in', '/sign-up'],
    },
    {
        id: 'sign-in-google',
        title: 'Sign in / sign up with Google OAuth',
        area: 'auth',
        routes: ['/sign-in', '/sign-up'],
        excluded: 'Google OAuth provider is not configured in any environment',
    },

    /* ---------------------------------------------------------------- */
    /* Dashboard overview                                                */
    /* ---------------------------------------------------------------- */
    {
        id: 'dashboard-widgets-render',
        title: 'Overview widgets render (storage, history, retrievals)',
        area: 'dashboard',
        routes: ['/dashboard'],
    },
    {
        id: 'dashboard-storage-usage-widget',
        title: 'Storage Usage widget reflects uploaded bytes',
        area: 'dashboard',
        routes: ['/dashboard'],
        manual: 'Needs a real upload to move the usage number; exercised by the validate tier',
    },

    /* ---------------------------------------------------------------- */
    /* Files                                                             */
    /* ---------------------------------------------------------------- */
    {
        id: 'files-empty-state',
        title: 'Empty vault state with upload CTA',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-grouped-render',
        title: 'Files render grouped by upload batch (+ Ungrouped)',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-stats-bar',
        title: 'Library stats bar shows archived/retrieving/available counts',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-search',
        title: 'Search filters files and shows no-match state',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-view-toggle',
        title: 'Toggle between list and grid view',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-batch-expand-collapse',
        title: 'Expand/collapse a batch group',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-select-all',
        title: 'Select-all checkbox selects all visible files',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-multi-select',
        title: 'Multi-select files (incl. shift-click range) shows selection bar',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-bulk-delete',
        title: 'Bulk delete selected files via confirm dialog',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-bulk-retrieve',
        title: 'Bulk retrieve archived files from selection bar',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-delete-single',
        title: 'Delete a single file from its actions menu',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-request-retrieval-single',
        title: 'Request retrieval of an archived file',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-download-available',
        title: 'Download an available file via presigned URL',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-batch-restore',
        title: 'Restore an entire batch from its header button',
        area: 'files',
        routes: ['/dashboard/files'],
    },
    {
        id: 'files-deep-link-focus',
        title: 'Deep-link ?file={id} highlights the target file (retrieval-ready email landing)',
        area: 'files',
        routes: ['/dashboard/files'],
    },

    /* ---------------------------------------------------------------- */
    /* Upload                                                            */
    /* ---------------------------------------------------------------- */
    {
        id: 'upload-add-files-queue',
        title: 'Add files to the upload queue (names/sizes shown)',
        area: 'upload',
        routes: ['/dashboard/upload'],
    },
    {
        id: 'upload-clear-queue',
        title: 'Clear the pending upload queue',
        area: 'upload',
        routes: ['/dashboard/upload'],
    },
    {
        id: 'upload-single-file-flow',
        title: 'Upload a file end-to-end (S3 + DB + batch + usage)',
        area: 'upload',
        routes: ['/dashboard/upload'],
        manual: 'Writes real S3 objects + DB rows in the dev environment; exercised by the validate tier',
    },
    {
        id: 'upload-batch-grouping',
        title: 'Upload creates a batch visible on the files page',
        area: 'upload',
        routes: ['/dashboard/upload', '/dashboard/files'],
        manual: 'Depends on a real end-to-end upload; exercised by the validate tier',
    },
    {
        id: 'upload-quota-exceeded',
        title: 'Upload over quota soft cap surfaces an error',
        area: 'upload',
        routes: ['/dashboard/upload'],
        manual: 'Parks the dev user at 105% quota (destructive); exercised by the validate tier',
    },
    {
        id: 'upload-failure-retry',
        title: 'Failed upload shows error state and can be retried',
        area: 'upload',
        routes: ['/dashboard/upload'],
    },
    {
        id: 'upload-multipart',
        title: 'Multipart upload for files >100MB',
        area: 'upload',
        excluded:
            'Requires uploading >100MB through the browser; multipart init/complete/abort are covered by unit tests',
        routes: ['/dashboard/upload'],
    },
    {
        id: 'upload-resume-detect',
        title: 'Interrupted upload is detected on load and shown as resumable',
        area: 'upload',
        routes: ['/dashboard/upload'],
    },
    {
        id: 'upload-resume-flow',
        title: 'Re-adding an interrupted file resumes from the last completed part',
        area: 'upload',
        excluded:
            'Full resume needs a real >100MB multipart upload + S3 ListParts reconciliation; resume primitives and store/part logic are covered by unit tests, detection by upload-resume-detect',
        routes: ['/dashboard/upload'],
    },
    {
        id: 'upload-resume-one-click',
        title: 'Interrupted upload with a persisted handle is shown as one-click resumable',
        area: 'upload',
        routes: ['/dashboard/upload'],
    },

    /* ---------------------------------------------------------------- */
    /* Billing & subscription                                            */
    /* ---------------------------------------------------------------- */
    {
        id: 'subscription-current-plan-badge',
        title: 'Current plan card shows the Current badge',
        area: 'billing',
        routes: ['/dashboard/settings'],
    },
    {
        id: 'billing-interval-toggle',
        title: 'Monthly/Annual toggle updates plan prices',
        area: 'billing',
        routes: ['/dashboard/settings'],
    },
    {
        id: 'subscription-upgrade-trial-checkout',
        title: 'Trial user upgrading routes to Stripe Checkout',
        area: 'billing',
        routes: ['/dashboard/settings'],
    },
    {
        id: 'subscription-upgrade-paid-portal',
        title: 'Paid user upgrading routes to the portal, not Checkout',
        area: 'billing',
        routes: ['/dashboard/settings'],
    },
    {
        id: 'manage-billing-portal',
        title: 'Manage billing button enabled only with an active Stripe sub',
        area: 'billing',
        routes: ['/dashboard/settings'],
    },
    {
        id: 'stripe-checkout-completion',
        title: 'Complete a payment on Stripe Checkout',
        area: 'billing',
        routes: ['/dashboard/settings'],
        excluded:
            'Stripe-hosted external page; cannot be driven deterministically from Playwright',
    },
    {
        id: 'stripe-webhooks',
        title: 'Stripe webhook updates local subscription state',
        area: 'billing',
        routes: [],
        excluded:
            'Server-to-server flow with signed payloads; covered by integration tests, not browser-drivable',
    },

    /* ---------------------------------------------------------------- */
    /* Settings                                                          */
    /* ---------------------------------------------------------------- */
    {
        id: 'settings-sections-render',
        title: 'Settings page renders profile, subscription, password, danger zone',
        area: 'settings',
        routes: ['/dashboard/settings'],
    },
    {
        id: 'settings-profile-update',
        title: 'Update profile name/email',
        area: 'settings',
        routes: ['/dashboard/settings'],
        excluded:
            'Placeholder UI — no backend wired up yet (button is a no-op)',
    },
    {
        id: 'settings-password-change',
        title: 'Change password',
        area: 'settings',
        routes: ['/dashboard/settings'],
        excluded:
            'Placeholder UI — no backend wired up yet (button is a no-op)',
    },
    {
        id: 'settings-account-deletion',
        title: 'Delete account',
        area: 'settings',
        routes: ['/dashboard/settings'],
        excluded:
            'Placeholder UI — no backend wired up yet (button is a no-op)',
    },

    /* ---------------------------------------------------------------- */
    /* Admin · Jobs                                                      */
    /* ---------------------------------------------------------------- */
    {
        id: 'admin-jobs-status-cards',
        title: 'Job status cards show correct counts',
        area: 'admin-jobs',
        routes: ['/dashboard/admin/jobs'],
    },
    {
        id: 'admin-jobs-table',
        title: 'Jobs table renders columns with correct data',
        area: 'admin-jobs',
        routes: ['/dashboard/admin/jobs'],
    },
    {
        id: 'admin-jobs-filter',
        title: 'Status filters update the table (incl. empty state)',
        area: 'admin-jobs',
        routes: ['/dashboard/admin/jobs'],
    },
    {
        id: 'admin-jobs-pagination',
        title: 'Next/prev pagination navigates pages',
        area: 'admin-jobs',
        routes: ['/dashboard/admin/jobs'],
    },
    {
        id: 'admin-jobs-retry',
        title: 'Retry button requeues a failed job',
        area: 'admin-jobs',
        routes: ['/dashboard/admin/jobs'],
    },
    {
        id: 'admin-jobs-refresh',
        title: 'Refresh button refetches jobs and counts',
        area: 'admin-jobs',
        routes: ['/dashboard/admin/jobs'],
    },

    /* ---------------------------------------------------------------- */
    /* Admin · Dev tools                                                 */
    /* ---------------------------------------------------------------- */
    {
        id: 'devtools-summary-cards',
        title: 'Seed summary stat cards render',
        area: 'admin-dev-tools',
        routes: ['/dashboard/admin/dev-tools'],
    },
    {
        id: 'devtools-run-scenario',
        title: 'Run a seed scenario and see the result',
        area: 'admin-dev-tools',
        routes: ['/dashboard/admin/dev-tools'],
    },
    {
        id: 'devtools-seed-and-cleanup',
        title: 'Seed files for a user and clean them up',
        area: 'admin-dev-tools',
        routes: ['/dashboard/admin/dev-tools'],
    },
    {
        id: 'devtools-cleanup-all',
        title: 'Cleanup-all wipes every file / all seed data',
        area: 'admin-dev-tools',
        routes: ['/dashboard/admin/dev-tools'],
        excluded:
            'Destructive across the whole shared dev environment; not safe to automate',
    },

    /* ---------------------------------------------------------------- */
    /* Errors & feedback                                                 */
    /* ---------------------------------------------------------------- */
    {
        id: 'trpc-error-toast',
        title: 'tRPC error surfaces a toast notification',
        area: 'errors',
        routes: ['/dashboard'],
    },
    {
        id: 'route-error-boundary',
        title: 'error.tsx boundary renders for route errors',
        area: 'errors',
        routes: ['/dashboard'],
        excluded:
            'No deterministic way to throw during render without a dedicated test route; the build validates error.tsx compiles and exports a component',
    },
    {
        id: 'global-error-boundary',
        title: 'global-error.tsx boundary compiles and renders',
        area: 'errors',
        routes: ['/'],
        excluded:
            'Only triggers when the root layout itself throws, which cannot be simulated without breaking the whole app; the build validates it compiles',
    },
    {
        id: 'trial-expired-banner',
        title: 'Trial-expired banner shows for unpaid subscription',
        area: 'errors',
        routes: ['/dashboard'],
    },

    /* ---------------------------------------------------------------- */
    /* Navigation                                                        */
    /* ---------------------------------------------------------------- */
    {
        id: 'sidebar-navigation',
        title: 'Sidebar links navigate between dashboard pages',
        area: 'navigation',
        routes: ['/dashboard'],
    },
    {
        id: 'sidebar-admin-visibility',
        title: 'Admin nav items hidden from regular users',
        area: 'navigation',
        routes: ['/dashboard'],
    },
    {
        id: 'sidebar-storage-widget',
        title: 'Sidebar storage-used widget renders usage',
        area: 'navigation',
        routes: ['/dashboard'],
    },
    {
        id: 'landing-cta-signup',
        title: 'Landing CTA navigates to sign-up',
        area: 'navigation',
        routes: ['/'],
    },

    /* ------------------------------------------------------------------
     * Dev pages have no use-case entries: "page X renders" is exactly what
     * the @page: dimension measures, so mirroring each page as a *-renders
     * use-case would be pure ceremony (two manifest entries + two tags per
     * page encoding one fact).
     * ---------------------------------------------------------------- */

    /* ---------------------------------------------------------------- */
    /* Server-side flows (documented, not browser-drivable)              */
    /* ---------------------------------------------------------------- */
    {
        id: 's3-restore-webhook',
        title: 'S3 restore-complete webhook flips retrieval to ready',
        area: 'files',
        routes: [],
        excluded:
            'SNS server-to-server webhook; covered by integration tests, not browser-drivable',
    },
];

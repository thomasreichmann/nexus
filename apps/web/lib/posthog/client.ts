'use client';

import posthog, { DisplaySurveyType } from 'posthog-js';

import {
    DEFAULT_POSTHOG_HOST,
    POSTHOG_INGEST_PATH,
    resolveUiHost,
} from './hosts';
import type { PostHogEventName } from './events';

/**
 * Same double gate as instrumentation-client.ts: the key exists only in
 * Vercel's production/preview env tiers (see ASYMMETRY_ALLOWLIST in
 * scripts/check-vercel-env-parity.ts), and NEXT_PUBLIC_VERCEL_ENV — inlined on
 * every deployment because the project auto-exposes system env vars;
 * `process.env.VERCEL` isn't NEXT_PUBLIC_-prefixed so it can't gate here —
 * keeps a stray .env.local key from turning PostHog on in local dev, CI, and
 * the e2e production builds, which assert zero console errors.
 *
 * Raw process.env (not `@/lib/env`) is deliberate: the env proxy reads
 * process.env[key] dynamically, which the bundler can't inline into browser
 * code — only literal process.env.NEXT_PUBLIC_* expressions survive client
 * bundling. The clientSchema entries still validate these; they just can't be
 * the browser read site.
 */
const isEnabled = Boolean(
    process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_POSTHOG_KEY
);

let isInitialized = false;

/** Whether analytics is live — gates UI that would otherwise be a dead control. */
export function isAnalyticsEnabled(): boolean {
    return isEnabled;
}

/** Idempotent: React strict mode double-invokes the mount effect. */
export function initAnalytics(): void {
    if (!isEnabled || isInitialized) return;
    isInitialized = true;

    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;

    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        // First-party proxy; next.config.ts rewrites this to `host`.
        api_host: POSTHOG_INGEST_PATH,
        ui_host: resolveUiHost(host),
        // Opt into the current default set rather than the legacy ones. Most
        // relevant here: capture_pageview becomes 'history_change', which is
        // what makes client-side App Router navigations register as pageviews.
        defaults: '2026-06-25',
        autocapture: true,
        // Backstop to Sentry (#327): PostHog sees anything that reaches
        // window.onerror, and pins it to the replay it happened in.
        capture_exceptions: true,
        // All-session replay, not on-error sampling: at a 2-3 tester cohort
        // every session is worth watching, and the interesting ones are the
        // sessions where nothing threw and the tester just left.
        disable_session_recording: false,
        session_recording: {
            // Same call as the Sentry replay config: replays exist to debug
            // known alpha testers, so visibility beats redaction. The recorder
            // masks password inputs regardless of this flag.
            maskAllInputs: false,
            maskTextSelector: null,
        },
        // No person profile for anonymous traffic — replays and events still
        // record, they just don't mint a profile until identify().
        person_profiles: 'identified_only',
    });
}

/**
 * Binds the session to the PostHog person. Called on every render that has a
 * user, and cheap to repeat: the SDK short-circuits when the distinct id is
 * already the one being identified.
 */
export function identifyUser(userId: string): void {
    if (!isEnabled || !isInitialized) return;
    posthog.identify(userId);
}

/** Unbinds the person on sign-out so the next user isn't merged into the last. */
export function resetAnalytics(): void {
    if (!isEnabled || !isInitialized) return;
    posthog.reset();
}

export function captureEvent(
    event: PostHogEventName,
    properties?: Record<string, unknown>
): void {
    if (!isEnabled || !isInitialized) return;
    posthog.capture(event, properties);
}

/**
 * Opens the feedback survey configured in PostHog. Resolved at click time
 * rather than hardcoding a survey id, so the survey can be rewritten (or
 * swapped for a different one) in the PostHog UI without a deploy.
 *
 * `ignoreConditions`/`ignoreDelay` bypass the survey's own targeting: the user
 * asked for it explicitly, so display rules meant for unprompted popups
 * shouldn't suppress it.
 */
export function showFeedbackSurvey(onUnavailable: () => void): void {
    if (!isEnabled || !isInitialized) {
        onUnavailable();
        return;
    }
    posthog.getActiveMatchingSurveys((surveys) => {
        const survey = surveys[0];
        if (!survey) {
            onUnavailable();
            return;
        }
        posthog.displaySurvey(survey.id, {
            displayType: DisplaySurveyType.Popover,
            ignoreConditions: true,
            ignoreDelay: true,
        });
    });
}

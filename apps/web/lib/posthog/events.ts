/**
 * The event vocabulary lives in `@nexus/analytics` so the worker Lambda —
 * which cannot import from the app (#425) — emits the same names. Re-exported
 * here so the app's call sites keep one import path for names and the
 * browser-only survey constant below.
 */
export {
    ANALYTICS_ENVIRONMENT_PROPERTY,
    PostHogEvent,
    type PostHogEventName,
} from '@nexus/analytics/events';

/**
 * Name of the survey behind the "Send feedback" menu item, matched at click
 * time. The lookup returns every live survey in the project, so picking the
 * first would quietly hand the button to an unrelated campaign the moment a
 * second survey is switched on in the PostHog UI.
 *
 * This makes the name load-bearing: rewrite the survey's questions freely, but
 * renaming it in PostHog disables the button (it falls back to the
 * "unavailable" toast) until this constant follows.
 *
 * Stays in the app rather than the package: surveys are a browser-SDK feature
 * with no server-side counterpart.
 */
export const FEEDBACK_SURVEY_NAME = 'Alpha feedback';

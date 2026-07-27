/**
 * PostHog host resolution, shared by the browser SDK, the Node SDK, and the
 * `/ingest` rewrite in next.config.ts. Kept dependency-free so next.config.ts
 * can import it before any path aliases or bundler config exist.
 */

/** PostHog US cloud ingestion host — the default when the env var is unset. */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/**
 * Path the reverse proxy is mounted at. Browser traffic goes to a first-party
 * path so adblock filter lists (which match on posthog.com) can't silently
 * zero out session replay — a blocked tester would otherwise be
 * indistinguishable from a tester who never showed up, which is the exact
 * failure this integration exists to detect.
 */
export const POSTHOG_INGEST_PATH = '/ingest';

/**
 * Both helpers below rewrite a PostHog *cloud* ingestion host by substring.
 * A host that doesn't match (a self-hosted instance) is returned unchanged,
 * which is the right answer there: a self-hosted deployment serves assets and
 * the dashboard off the one origin, so no rewrite is what's wanted.
 */

/**
 * Static assets (the recorder, surveys, and toolbar bundles) are served from a
 * sibling host, not the ingestion host: `us.i.posthog.com` →
 * `us-assets.i.posthog.com`. Same shape for the EU region.
 */
export function resolveAssetsHost(host: string): string {
    return host.replace('.i.posthog.com', '-assets.i.posthog.com');
}

/**
 * The dashboard host, used for toolbar links only. Drops the ingestion
 * subdomain: `us.i.posthog.com` → `us.posthog.com`.
 */
export function resolveUiHost(host: string): string {
    return host.replace('.i.posthog.com', '.posthog.com');
}

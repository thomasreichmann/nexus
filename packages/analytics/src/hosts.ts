/**
 * PostHog US cloud ingestion host — the default when the env var is unset.
 *
 * Its own module, dependency-free, because every runtime that captures needs
 * it but they can't share a bundle: apps/web reaches it through
 * `lib/posthog/hosts.ts`, which next.config.ts imports before any path aliases
 * or bundler config exist, and the worker Lambda imports it directly.
 *
 * The package deliberately has no root export for the same reason. `./server`
 * pulls in posthog-node, and one barrel re-exporting it would drag `node:fs`
 * into the browser bundle through the client SDK's event-name import — which
 * is exactly how it failed the first time.
 */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

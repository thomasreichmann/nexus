/**
 * Shared path for the e2e webServer's piped stdout/stderr.
 *
 * The compact reporter (e2e/reporters/compact.ts) owns terminal stdio, which
 * makes Playwright drop the webServer child's output entirely — so a failing
 * test never shows the server-side error that actually caused it. To get that
 * output back, the webServer command tees its stream to this file, and the
 * reporter reads the failing test's slice out of it on failure.
 *
 * Relative to the config dir (apps/web), which is the cwd for both the
 * webServer child and the Playwright process, so both agree on the location.
 */
export const WEBSERVER_LOG = 'e2e/.webserver.log';

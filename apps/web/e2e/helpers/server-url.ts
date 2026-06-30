import { execFileSync } from 'node:child_process';

/**
 * The e2e suite runs against a production server (next build + next start). It
 * binds an ephemeral free port rather than a fixed one so it never collides
 * with a running `pnpm dev` (or anything else) — the dev server is exactly the
 * thing we're avoiding, so we must not reuse it or fight it for a port.
 *
 * The port is chosen once, in the Playwright main process during config
 * evaluation, and published on PLAYWRIGHT_E2E_PORT. The webServer child and the
 * test workers inherit that env var (and re-read it here instead of picking a
 * new port), so every process agrees on the same URL. Set PLAYWRIGHT_E2E_PORT
 * yourself to pin a specific port.
 */
function resolvePort(): number {
    const existing = process.env.PLAYWRIGHT_E2E_PORT;
    if (existing) return Number(existing);

    // Let the OS hand back a free port via listen(0). Done in a short-lived
    // child so it stays synchronous — Playwright evaluates the config (and this
    // module) synchronously, before the server or workers start.
    const out = execFileSync(
        process.execPath,
        [
            '-e',
            "const s=require('net').createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close();});",
        ],
        { encoding: 'utf8' }
    );

    const port = Number(out.trim());
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Could not resolve a free e2e port (got "${out}")`);
    }

    // Publish for the webServer child and test workers spawned after this.
    process.env.PLAYWRIGHT_E2E_PORT = String(port);
    return port;
}

export const E2E_PORT = resolvePort();
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

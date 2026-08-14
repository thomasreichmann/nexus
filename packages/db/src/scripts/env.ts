import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Names the database a CLI is about to touch, without its password.
 *
 * `new URL` splits credentials into `.username` and `.password`, so a banner
 * built from the other fields cannot leak the secret by accident — the field
 * simply isn't named here.
 *
 * The user is included on purpose, and it carries the weight. Every Supabase
 * project reaches the same pooler host and a database literally named
 * `postgres`, so host and path alone print identically for dev and prod; the
 * project ref that distinguishes them lives in the user. It is not a secret —
 * the same ref ships to the browser in `NEXT_PUBLIC_SUPABASE_URL`.
 *
 * `DB_ENV` is appended as a hint, not as the answer. It is a separate variable
 * — an exported value wins, otherwise `.env.local` supplies it — so it records
 * what someone declared the environment to be, which is what the seed guard
 * gates on. Only the user and host come from the URL actually being connected
 * to, so only those two cannot lie.
 */
export function formatDatabaseTarget(databaseUrl: string): string {
    let target: URL;
    try {
        target = new URL(databaseUrl);
    } catch {
        return '→ (unparseable DATABASE_URL)';
    }

    const host = `${target.hostname}:${target.port || '5432'}${target.pathname}`;
    const user = target.username ? `${target.username} @ ` : '';
    const dbEnv = process.env.DB_ENV ? `  (DB_ENV=${process.env.DB_ENV})` : '';
    return `→ ${user}${host}${dbEnv}`;
}

/**
 * Dev-only CLI bootstrap: loads the web app's .env.local — the single env
 * source for all local tooling (docs/guides/environment-setup.md) — and
 * returns DATABASE_URL, exiting with a friendly message when it's missing.
 *
 * Announces the target on stderr as a side effect, so no caller has to
 * remember to and stdout stays pipeable.
 */
export function requireDatabaseUrl(): string {
    // quiet: dotenv's load notice goes to stdout, which would land in the
    // middle of `db:query`'s JSON and break piping into jq.
    config({
        path: resolve(import.meta.dirname, '../../../../apps/web/.env.local'),
        quiet: true,
    });
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error(
            'DATABASE_URL is not set. Check apps/web/.env.local exists.'
        );
        process.exit(1);
    }
    console.error(formatDatabaseTarget(databaseUrl));
    return databaseUrl;
}

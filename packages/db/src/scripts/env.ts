import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Dev-only CLI bootstrap: loads the web app's .env.local — the single env
 * source for all local tooling (docs/guides/environment-setup.md) — and
 * returns DATABASE_URL, exiting with a friendly message when it's missing.
 */
export function requireDatabaseUrl(): string {
    config({
        path: resolve(import.meta.dirname, '../../../../apps/web/.env.local'),
    });
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error(
            'DATABASE_URL is not set. Check apps/web/.env.local exists.'
        );
        process.exit(1);
    }
    return databaseUrl;
}

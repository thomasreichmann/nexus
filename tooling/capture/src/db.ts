import { config } from 'dotenv';

import { createDb } from '@nexus/db';
import type { Connection } from '@nexus/db';

import { WEB_ENV } from './paths';

// Same source of truth as drizzle, the seed CLI, and the e2e suite: the web
// app's .env.local. Load it before reading DATABASE_URL.
config({ path: WEB_ENV, quiet: true });

// A real connection (not a transaction), so callers can `db.$client.end()`.
export type Db = Connection;

export function resolveDatabaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            `No DATABASE_URL. Expected it in ${WEB_ENV} (run \`pnpm env:pull\`).`
        );
    }
    return url;
}

/** Connect to the same dev database the running app uses. */
export function connect(): Connection {
    // createDb already sets prepare:false for Supabase's transaction pooler.
    return createDb(resolveDatabaseUrl());
}

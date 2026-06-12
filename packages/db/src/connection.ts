import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options } from 'postgres';
import * as schema from './schema';

export function createDb(
    url: string,
    options?: Options<Record<string, never>>
) {
    const client = postgres(url, {
        // Supabase's transaction-mode pooler (port 6543) does not support
        // prepared statements: statements can land on different pooled
        // backends, which intermittently loses transactions (observed as
        // confirmUpload's status flip returning success but never
        // committing). Callers on a direct connection can override.
        prepare: false,
        ...options,
    });
    return drizzle(client, { schema });
}

/** Raw database connection type */
export type Connection = ReturnType<typeof createDb>;

/** Transaction type - extracted from db.transaction callback parameter */
export type Transaction = Parameters<
    Parameters<Connection['transaction']>[0]
>[0];

/** Database type that accepts both connections and transactions */
export type DB = Connection | Transaction;

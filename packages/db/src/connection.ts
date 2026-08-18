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
        // Bound contention so it fails fast instead of hanging (#379: a
        // dashboard query queued behind the pooler's backend pool waited
        // forever, and the HTTP request carrying it hung with no error).
        // postgres-js has no client-side acquire/query timeout, so the bounds
        // are: pool size explicit (the driver default, but load-bearing here),
        // connection establishment capped, and execution capped server-side.
        // statement_timeout travels as a startup parameter and lands on direct
        // connections (local e2e, `show statement_timeout` = 1min); Supabase's
        // pooler ignores it and applies its own role default instead (measured
        // 2min), so execution is bounded on every path — just by Supabase's
        // value there, not ours. A wait in the pooler's backend queue is the
        // one stage only the pooler can bound.
        max: 10,
        connect_timeout: 10,
        connection: { statement_timeout: 60_000 },
        // Shallow spread on purpose: a caller passing `connection` owns the
        // whole startup-parameter set, timeout included.
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

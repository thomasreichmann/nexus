import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options } from 'postgres';
import * as schema from './schema';

export function createDb(
    url: string,
    options?: Options<Record<string, never>>
) {
    const client = postgres(url, options);
    return drizzle(client, { schema });
}

/** Raw database connection type */
type Connection = ReturnType<typeof createDb>;

/** Transaction type - extracted from db.transaction callback parameter */
export type Transaction = Parameters<
    Parameters<Connection['transaction']>[0]
>[0];

/** Database type that accepts both connections and transactions */
export type DB = Connection | Transaction;

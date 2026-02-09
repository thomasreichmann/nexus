import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(url: string) {
    const client = postgres(url);
    return drizzle(client, { schema });
}

/** Shared database type for repositories and services */
export type DB = ReturnType<typeof createDb>;

/** Transaction type - extracted from db.transaction callback parameter */
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];

/** Type that accepts both DB and Transaction - use in repository functions that may be called within transactions */
export type DBOrTransaction = DB | Transaction;

// Re-export everything
export * from './schema';
export * as schema from './schema';
export * from './repositories';
export * from './jobs/types';

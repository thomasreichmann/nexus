import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });

/** Shared database type for repositories and services */
export type DB = typeof db;

/** Transaction type for use within db.transaction callbacks */
export type Transaction = PgTransaction<
    PostgresJsQueryResultHKT,
    typeof schema,
    ExtractTablesWithRelations<typeof schema>
>;

/** Type that accepts both DB and Transaction - use in repository functions that may be called within transactions */
export type DBOrTransaction = DB | Transaction;

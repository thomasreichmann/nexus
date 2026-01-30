import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

const client = postgres(env.DATABASE_URL);

export const db = drizzle(client, { schema });

/** Shared database type for repositories and services */
export type DB = typeof db;

/** Transaction type - extracted from db.transaction callback parameter */
export type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0];

/** Type that accepts both DB and Transaction - use in repository functions that may be called within transactions */
export type DBOrTransaction = DB | Transaction;

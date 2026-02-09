import { createDb } from '@nexus/db';
import { env } from '@/lib/env';

export const db = createDb(env.DATABASE_URL);
export type { DB, Transaction, DBOrTransaction } from '@nexus/db';

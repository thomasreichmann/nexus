import { createDb, type Connection } from '@nexus/db/test-db';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

/**
 * Builds a typed Drizzle connection to the dev DB for back-door test setup.
 *
 * Fixtures own a single worker-scoped connection (see `fixtures/db.ts`); use
 * this directly only where the fixture chain isn't available — the `setup`
 * Playwright project (`global.setup.ts`), which runs outside the chain. Callers
 * are responsible for `db.$client.end()`.
 */
export function createTestDb(): Connection {
    return createDb(process.env.DATABASE_URL!);
}

/**
 * Runs `fn` against a short-lived connection and always closes it. The shape
 * every unauthenticated spec needs — those run outside the fixture chain, so
 * they can't use the worker-scoped `db` fixture and would otherwise repeat the
 * connect/try/finally-end dance at every call site.
 */
export async function withTestDb<T>(
    fn: (db: Connection) => Promise<T>
): Promise<T> {
    const db = createTestDb();
    try {
        return await fn(db);
    } finally {
        await db.$client.end({ timeout: 5 });
    }
}

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

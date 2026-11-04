import { vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { it, describe, expect } from '@nexus/db/test-db/integration';

// On 2026-10-20 a read the boot check had abandoned left its backend holding
// a lock on `files` while it waited on a client that never came back (#554).
// With `isHolding` set, the check's read becomes a transaction that reads
// `files` and then never finishes, which puts its backend in that state on
// purpose: lock held, waiting on the client. 0 is never a real backend pid,
// so it means the read never reached the database.
const heldBackend = vi.hoisted(() => ({ isHolding: false, pid: 0 }));

vi.mock('@nexus/db/repo/files', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@nexus/db/repo/files')>();
    return {
        ...actual,
        createFileRepo: (db: DB) => {
            const repo = actual.createFileRepo(db);
            if (!heldBackend.isHolding) return repo;
            return {
                ...repo,
                findLatestReadyThumbnail: () =>
                    db.transaction(async (tx) => {
                        await tx.execute(sql`select 1 from files limit 1`);
                        const [row] = await tx.execute<{ pid: number }>(
                            sql`select pg_backend_pid() as pid`
                        );
                        heldBackend.pid = row.pid;
                        return new Promise<never>(() => {});
                    }),
            };
        },
    };
});

// The check builds its own client; keep a handle on it to ask whether it was
// closed.
const checkDb = vi.hoisted(() => ({ connection: null as Connection | null }));

vi.mock('@nexus/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@nexus/db')>();
    return {
        ...actual,
        createDb: (...args: Parameters<typeof actual.createDb>) => {
            checkDb.connection = actual.createDb(...args);
            return checkDb.connection;
        },
    };
});

// Only what leaves the process is faked.
vi.mock('@/lib/storage', () => ({
    s3: { derived: { isConfigured: () => true, probe: async () => {} } },
}));

import { runDerivedBucketCheck } from './derivedBucketCheck';
import type { Connection, DB } from '@nexus/db/test-db';

async function countLocksOnFiles(db: DB, pid: number): Promise<number> {
    const [row] = await db.execute<{ count: number }>(sql`
        select count(*)::int as count from pg_locks
        where pid = ${pid} and relation = 'files'::regclass
    `);
    return row.count;
}

describe('runDerivedBucketCheck', () => {
    // Asserts the lock rather than the backend: behind the transaction-mode
    // pooler a disconnect may recycle the backend instead of ending it, and
    // the lock is what blocked the migration.
    it('releases the lock its abandoned read holds on files', async ({
        db,
    }) => {
        heldBackend.isHolding = true;

        // Long enough for a cold connection to the pooled dev DB to reach
        // the hold before the timer fires.
        await runDerivedBucketCheck(3_000);

        expect(heldBackend.pid).toBeGreaterThan(0);
        await expect
            .poll(() => countLocksOnFiles(db, heldBackend.pid), {
                timeout: 5_000,
            })
            .toBe(0);
    });

    it('closes its connection when the check finishes in time', async () => {
        heldBackend.isHolding = false;
        checkDb.connection = null;

        await runDerivedBucketCheck(3_000);

        await expect(
            checkDb.connection?.$client.unsafe('select 1')
        ).rejects.toMatchObject({ code: 'CONNECTION_ENDED' });
    });
});

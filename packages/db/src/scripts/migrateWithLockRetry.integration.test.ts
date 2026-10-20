import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from '../test-db/integration';
import {
    createMigrationClient,
    migrateWithLockRetry,
} from './migrateWithLockRetry';
import type { Sql } from 'postgres';
import type { OnTestFinishedHandler } from 'vitest';
import type { Connection } from '../connection';

interface Retry {
    attempt: number;
    delayMs: number;
}

/**
 * A schema of this test's own, holding a `probe` table and its migrations
 * table, a migrations folder with `migration` in it, and the client
 * `db:migrate` would apply it with. All of it is removed afterwards, along
 * with any lock still held, step by step so one failed step can't strand the
 * rest on the shared dev DB.
 */
async function createProbe(
    db: Connection,
    onTestFinished: (handler: OnTestFinishedHandler) => void,
    migration: (schema: string) => string
) {
    // The `db` fixture has already checked DATABASE_URL is set.
    const client = createMigrationClient(process.env.DATABASE_URL!);
    const schema = `migrate_lock_${randomUUID().slice(0, 8)}`;
    const table = sql`${sql.identifier(schema)}.probe`;
    const migrationsFolder = join(tmpdir(), `migrate-lock-${schema}`);
    let release: (() => Promise<void>) | undefined;
    onTestFinished(async () => {
        await Promise.allSettled([release?.()]);
        try {
            await client`drop schema if exists ${client(schema)} cascade`;
        } finally {
            await client.end();
            await rm(migrationsFolder, { recursive: true, force: true });
        }
    });

    await client`create schema ${client(schema)}`;
    await client`create table ${client(schema)}.probe (id integer)`;
    await mkdir(join(migrationsFolder, 'meta'), { recursive: true });
    await writeFile(
        join(migrationsFolder, 'meta', '_journal.json'),
        JSON.stringify({
            version: '7',
            dialect: 'postgresql',
            entries: [
                {
                    idx: 0,
                    version: '7',
                    when: Date.now(),
                    tag: '0000_probe',
                    breakpoints: true,
                },
            ],
        })
    );
    await writeFile(
        join(migrationsFolder, '0000_probe.sql'),
        migration(schema)
    );

    return {
        client,
        config: { migrationsFolder, migrationsSchema: schema },

        /**
         * Reads `probe` in a transaction on another connection and keeps it
         * open, holding the lock an ALTER has to wait for, until the returned
         * release() ends it.
         */
        async holdReadLock(): Promise<() => Promise<void>> {
            let letGo!: () => void;
            const whenLetGo = new Promise<void>((resolve) => (letGo = resolve));
            let markHeld!: () => void;
            const whenHeld = new Promise<void>(
                (resolve) => (markHeld = resolve)
            );
            const transaction = db.transaction(async (tx) => {
                await tx.execute(sql`select from ${table}`);
                markHeld();
                await whenLetGo;
            });
            await Promise.race([whenHeld, transaction]);
            release = () => {
                letGo();
                return transaction;
            };
            return release;
        },

        async readColumns(): Promise<string[]> {
            const rows = await db.execute<{ column_name: string }>(
                sql`select column_name from information_schema.columns
                    where table_schema = ${schema} and table_name = 'probe'
                    order by ordinal_position`
            );
            return rows.map((row) => row.column_name);
        },

        async countApplied(): Promise<number> {
            const [row] = await db.execute<{ count: number }>(
                sql`select count(*)::int as count from ${sql.identifier(schema)}.__drizzle_migrations`
            );
            return row!.count;
        },
    };
}

async function showLockTimeout(client: Sql): Promise<string> {
    const [row] = await client<{ lock_timeout: string }[]>`show lock_timeout`;
    return row!.lock_timeout;
}

// #550's ALTER on prod waited 2 minutes for a lock a stranded session held,
// and prod's reads of the table queued behind it for all of that, twice (#555).
describe('migrateWithLockRetry', () => {
    const addColumn = (schema: string) =>
        `ALTER TABLE "${schema}"."probe" ADD COLUMN "added" integer;`;

    it('gives up on a lock still held after its last retry, and applies nothing', async ({
        db,
        onTestFinished,
    }) => {
        const probe = await createProbe(db, onTestFinished, addColumn);
        await probe.holdReadLock();
        const retried: Retry[] = [];

        await expect(
            migrateWithLockRetry(probe.client, probe.config, {
                lockTimeout: '100ms',
                retryDelaysMs: [0, 5],
                onRetry: (retry) => {
                    retried.push(retry);
                },
            })
        ).rejects.toMatchObject({ cause: { code: '55P03' } });

        expect(retried).toEqual([
            { attempt: 1, delayMs: 0 },
            { attempt: 2, delayMs: 5 },
        ]);
        expect(await probe.readColumns()).toEqual(['id']);
        expect(await probe.countApplied()).toBe(0);
    });

    it('keeps trying while the lock is held, and applies the migration once it is let go', async ({
        db,
        onTestFinished,
    }) => {
        const probe = await createProbe(db, onTestFinished, addColumn);
        const release = await probe.holdReadLock();
        const retried: Retry[] = [];

        await migrateWithLockRetry(probe.client, probe.config, {
            lockTimeout: '100ms',
            retryDelaysMs: [0, 5, 10],
            onRetry: async (retry) => {
                retried.push(retry);
                if (retried.length === 2) await release();
            },
        });

        expect(retried).toEqual([
            { attempt: 1, delayMs: 0 },
            { attempt: 2, delayMs: 5 },
        ]);
        expect(await probe.readColumns()).toEqual(['id', 'added']);
        expect(await probe.countApplied()).toBe(1);
    });

    // A session-level SET would stay on a pooled backend the app then uses.
    // This client has one connection, so a leak shows on its next statement.
    it('leaves the session’s own lock_timeout as it found it', async ({
        db,
        onTestFinished,
    }) => {
        const probe = await createProbe(db, onTestFinished, addColumn);
        const before = await showLockTimeout(probe.client);

        await migrateWithLockRetry(probe.client, probe.config, {
            lockTimeout: '100ms',
            onRetry: () => {},
        });

        expect(await showLockTimeout(probe.client)).toBe(before);
    });

    it('fails a migration that broke for another reason without retrying it', async ({
        db,
        onTestFinished,
    }) => {
        const probe = await createProbe(
            db,
            onTestFinished,
            (schema) =>
                `ALTER TABLE "${schema}"."missing" ADD COLUMN "added" integer;`
        );
        const retried: Retry[] = [];

        await expect(
            migrateWithLockRetry(probe.client, probe.config, {
                retryDelaysMs: [0],
                onRetry: (retry) => {
                    retried.push(retry);
                },
            })
        ).rejects.toMatchObject({ cause: { code: '42P01' } });

        expect(retried).toEqual([]);
    });
});

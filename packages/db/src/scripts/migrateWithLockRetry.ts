import { setTimeout as sleep } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import type { MigrationConfig } from 'drizzle-orm/migrator';

/**
 * How long a migration statement may wait for a lock before giving up.
 *
 * DDL like `ALTER TABLE` needs an exclusive lock, and while it waits in the
 * queue every later reader of that table waits behind it. So this is also how
 * long a blocked migration can stall the app. With no bound but the server's
 * 2-minute statement_timeout, #550's `ALTER TABLE files` stalled prod's file
 * reads for those 2 minutes, twice, behind a stranded session's lock (#555).
 */
export const LOCK_TIMEOUT = '3s';

/**
 * The wait before each retry of a migration that gave up on a lock. A lock
 * still held after the last one fails the run, and someone has to find who
 * holds it (docs/infra/prod-db-locks.md).
 */
export const LOCK_RETRY_DELAYS_MS: readonly number[] = [10_000, 30_000, 60_000];

// Postgres's lock_not_available, which lock_timeout raises.
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * The client `db:migrate` runs on: one connection, `prepare: false` for
 * Supabase's transaction pooler (as in createDb), and the `create … if not
 * exists` notices the migrator sets off on every run kept off the console.
 */
export function createMigrationClient(databaseUrl: string): Sql {
    return postgres(databaseUrl, {
        prepare: false,
        max: 1,
        onnotice: () => {},
    });
}

interface LockRetry {
    /** The attempt that just gave up, from 1. */
    attempt: number;
    delayMs: number;
}

interface LockRetryOptions {
    lockTimeout?: string;
    retryDelaysMs?: readonly number[];
    /** Called before each retry's wait; awaited. */
    onRetry: (retry: LockRetry) => void | Promise<void>;
}

/**
 * Applies pending migrations with drizzle's own migrator, giving up on a held
 * lock after `lockTimeout` and trying again after each of `retryDelaysMs`.
 *
 * A retry starts clean: drizzle applies every pending migration in one
 * transaction, so a migration that gave up rolled back all of them.
 */
export async function migrateWithLockRetry(
    sql: Sql,
    config: MigrationConfig,
    {
        lockTimeout = LOCK_TIMEOUT,
        retryDelaysMs = LOCK_RETRY_DELAYS_MS,
        onRetry,
    }: LockRetryOptions
): Promise<void> {
    const db = drizzle(withLockTimeout(sql, lockTimeout));
    for (let attempt = 1; ; attempt++) {
        try {
            await migrate(db, config);
            return;
        } catch (err) {
            const delayMs = retryDelaysMs[attempt - 1];
            if (delayMs === undefined || !isLockTimeout(err)) throw err;
            await onRetry({ attempt, delayMs });
            await sleep(delayMs);
        }
    }
}

/**
 * True when `err` is Postgres giving up on a lock. drizzle wraps the driver's
 * error, so the SQLSTATE is on its `cause`.
 */
export function isLockTimeout(err: unknown): boolean {
    const { cause } = err as { cause?: { code?: unknown } };
    return cause?.code === LOCK_NOT_AVAILABLE;
}

/**
 * `sql`, with `lock_timeout` set at the start of each of its transactions.
 *
 * drizzle's migrator runs the migrations in one transaction, and postgres-js
 * opens every transaction with `begin`. Setting it for the session instead
 * wouldn't hold: through Supabase's transaction pooler, which the deployed
 * DATABASE_URLs point at, each transaction can land on a different backend,
 * and a session-level SET would stay behind on a backend the app goes on to
 * use. `set_config(…, true)` lasts only until the transaction ends.
 */
function withLockTimeout(sql: Sql, lockTimeout: string): Sql {
    const begin = (callback: (tx: TransactionSql) => Promise<unknown>) =>
        sql.begin(async (tx) => {
            await tx`select set_config('lock_timeout', ${lockTimeout}, true)`;
            return callback(tx);
        });
    return new Proxy(sql, {
        get: (target, property) =>
            property === 'begin' ? begin : Reflect.get(target, property),
    });
}

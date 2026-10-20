/**
 * Applies pending migrations to the current env's database:
 *
 *   pnpm -F db db:migrate
 *
 * drizzle's own migrator, run through `migrateWithLockRetry` so a migration
 * that can't get its lock gives up within seconds and tries again, instead of
 * stalling every reader of the table it waits on (#555). `drizzle-kit migrate`
 * has no lock timeout to set.
 */
import { resolve } from 'node:path';
import { requireDatabaseUrl } from './env';
import {
    createMigrationClient,
    isLockTimeout,
    LOCK_RETRY_DELAYS_MS,
    LOCK_TIMEOUT,
    migrateWithLockRetry,
} from './migrateWithLockRetry';

const sql = createMigrationClient(requireDatabaseUrl());

async function main() {
    try {
        await migrateWithLockRetry(
            sql,
            { migrationsFolder: resolve(import.meta.dirname, '../migrations') },
            {
                onRetry: ({ attempt, delayMs }) =>
                    console.error(
                        `Attempt ${attempt} waited ${LOCK_TIMEOUT} for a lock and gave up; retrying in ${delayMs / 1000}s`
                    ),
            }
        );
        console.log('Migrations applied');
    } catch (err) {
        const failure = err as {
            message?: string;
            cause?: { message?: string };
        };
        console.error(`Migration failed: ${failure.message ?? String(err)}`);
        if (failure.cause?.message) {
            console.error(`  cause: ${failure.cause.message}`);
        }
        if (isLockTimeout(err)) {
            console.error(
                `Still blocked on a lock after ${LOCK_RETRY_DELAYS_MS.length + 1} attempts. Find who holds it: docs/infra/prod-db-locks.md`
            );
        }
        process.exitCode = 1;
    } finally {
        await sql.end({ timeout: 5 });
    }
}

void main();

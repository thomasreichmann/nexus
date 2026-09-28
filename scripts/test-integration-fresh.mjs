#!/usr/bin/env node
/**
 * Runs the integration tier against a throwaway Postgres instead of the shared
 * dev database:
 *
 *   pnpm test:integration:fresh                      # every package's tier
 *   pnpm test:integration:fresh --filter=@nexus/db   # one package
 *
 * Starts an empty Postgres 17 (Supabase's major) from the `embedded-postgres`
 * binaries in a temp dir on a free port, applies every migration, runs
 * `pnpm test:integration` with DATABASE_URL pointing at it, fails if the run
 * left any user behind, then stops it and deletes the data. Arguments are
 * passed through to turbo.
 *
 * This is what CI's Postgres service container looks like (#384): nothing
 * seeded, no other writers. A test that passes here and on dev doesn't depend
 * on leftover rows or on being alone. It is also ~10x faster than dev, since
 * each statement is a local round trip rather than a pooler one.
 *
 * Only the database is swapped. Every other variable still comes from
 * apps/web/.env.local, so anything a test doesn't mock (e.g. an SQS publish)
 * still reaches the dev resources behind it.
 */
import { run, withThrowawayPostgres } from './throwaway-postgres.mjs';

/**
 * The database started empty, so any user left after the run leaked (#491).
 * Every user-owned row cascades from `user`, so counting users covers them.
 */
async function countLeakedUsers(pg, database) {
    const client = pg.getPgClient(database, '127.0.0.1');
    await client.connect();
    try {
        const { rows } = await client.query(
            'select count(*)::int as n from "user"'
        );
        const leaked = rows[0].n;
        if (leaked > 0) {
            console.error(
                `✗ the run left ${leaked} user row(s) behind: a test creates users outside the fixtures, or skips their teardown`
            );
        }
        return leaked;
    } finally {
        await client.end();
    }
}

async function main() {
    // Ctrl-C reaches the child processes directly; staying alive lets
    // withThrowawayPostgres stop Postgres and delete its data.
    process.on('SIGINT', () => {});

    const exitCode = await withThrowawayPostgres(
        async ({ env, pg, database }) => {
            console.error(`throwaway Postgres at ${env.DATABASE_URL}`);
            const code = await run(
                'pnpm',
                ['test:integration', ...process.argv.slice(2)],
                env
            );
            if (code === 0 && (await countLeakedUsers(pg, database)) > 0)
                return 1;
            return code;
        }
    );
    process.exit(exitCode);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

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
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATABASE = 'nexus';

function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function run(command, args, env) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            env: { ...process.env, ...env },
        });
        child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
}

/**
 * The database started empty, so any user left after the run leaked (#491).
 * Every user-owned row cascades from `user`, so counting users covers them.
 */
async function countLeakedUsers(pg) {
    const client = pg.getPgClient(DATABASE, '127.0.0.1');
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
    const dataDir = await mkdtemp(join(tmpdir(), 'nexus-integration-pg-'));
    const port = await freePort();
    const pg = new EmbeddedPostgres({
        databaseDir: dataDir,
        port,
        user: 'postgres',
        password: 'postgres',
        persistent: false,
        // initdb and the server log every step; only failures matter here.
        onLog: () => {},
        onError: (error) => console.error(String(error)),
    });

    // Ctrl-C reaches the child processes directly; staying alive lets the
    // finally block below stop Postgres and delete its data.
    process.on('SIGINT', () => {});

    let exitCode = 1;
    try {
        await pg.initialise();
        await pg.start();
        await pg.createDatabase(DATABASE);
        const env = {
            DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/${DATABASE}`,
            DB_ENV: 'throwaway',
        };
        console.error(`throwaway Postgres on 127.0.0.1:${port}`);

        exitCode = await run('pnpm', ['-F', '@nexus/db', 'db:migrate'], env);
        if (exitCode === 0) {
            exitCode = await run(
                'pnpm',
                ['test:integration', ...process.argv.slice(2)],
                env
            );
        }
        if (exitCode === 0 && (await countLeakedUsers(pg)) > 0) exitCode = 1;
    } finally {
        await pg.stop().catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
    }
    process.exit(exitCode);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

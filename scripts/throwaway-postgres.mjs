/**
 * An empty Postgres 17 (Supabase's major) from the `embedded-postgres`
 * binaries, in a temp dir on a free port, with every migration applied.
 * Shared by `pnpm test:integration:fresh` (#507) and `pnpm mutate` (#494).
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

/** Resolves the exit code; a signal counts as 1. */
export function run(command, args, env, stdio = 'inherit') {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio,
            env: { ...process.env, ...env },
        });
        child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    });
}

/**
 * Starts Postgres, migrates it, and calls `fn({ env, pg })` with the env
 * (`DATABASE_URL`, `DB_ENV`) that points at it. Stops it and deletes its data
 * afterwards, whatever `fn` does. Resolves what `fn` resolves, or 1 when the
 * migration fails. `quiet` hides the migration's output; `postgresFlags` go
 * to the server (e.g. `['-c', 'max_connections=400']`).
 */
export async function withThrowawayPostgres(
    fn,
    { quiet = false, postgresFlags = [] } = {}
) {
    const dataDir = await mkdtemp(join(tmpdir(), 'nexus-integration-pg-'));
    const port = await freePort();
    const pg = new EmbeddedPostgres({
        databaseDir: dataDir,
        port,
        user: 'postgres',
        password: 'postgres',
        persistent: false,
        postgresFlags,
        // initdb and the server log every step; only failures matter here.
        onLog: () => {},
        onError: (error) => console.error(String(error)),
    });
    try {
        await pg.initialise();
        await pg.start();
        await pg.createDatabase(DATABASE);
        const env = {
            DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/${DATABASE}`,
            DB_ENV: 'throwaway',
        };
        const migrated = await run(
            'pnpm',
            ['-F', '@nexus/db', 'db:migrate'],
            env,
            quiet ? 'ignore' : 'inherit'
        );
        if (migrated !== 0) {
            if (quiet)
                console.error(
                    '✗ migrating the throwaway Postgres failed: rerun with `pnpm test:integration:fresh` to see why'
                );
            return 1;
        }
        return await fn({ env, pg, database: DATABASE });
    } finally {
        await pg.stop().catch(() => {});
        await rm(dataDir, { recursive: true, force: true });
    }
}

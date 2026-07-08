/**
 * Read-only SQL forensics against the current env's database:
 *
 *   pnpm -F db db:query "select count(*) from files"
 *
 * Rows print as JSON on stdout; the target host and row count go to stderr,
 * so output pipes cleanly into jq. Every statement runs inside a
 * `BEGIN READ ONLY` transaction — Postgres itself rejects writes/DDL — so
 * it is safe to point at any env, including prod. For writes, use a
 * migration, the seed CLI, or the typed test-db helpers.
 */
import postgres from 'postgres';
import { requireDatabaseUrl } from './env';

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0]?.trim()) {
    console.error('Usage: pnpm -F db db:query "<sql>"');
    console.error(
        args.length > 1
            ? 'Got multiple arguments — quote the SQL as a single string.'
            : 'Pass exactly one SQL string.'
    );
    process.exit(1);
}
const query = args[0];

const databaseUrl = requireDatabaseUrl();

const target = new URL(databaseUrl);
console.error(
    `→ ${target.hostname}:${target.port || '5432'}${target.pathname}` +
        (process.env.DB_ENV ? ` (DB_ENV=${process.env.DB_ENV})` : '')
);

// prepare:false for Supabase's transaction-mode pooler, same as createDb().
const sql = postgres(databaseUrl, { prepare: false, max: 1 });

async function main() {
    try {
        const rows = await sql.begin('read only', (tx) => tx.unsafe(query));
        console.log(JSON.stringify(rows, null, 2));
        console.error(`(${Array.isArray(rows) ? rows.length : 0} rows)`);
    } catch (err) {
        const e = err as { message?: string; detail?: string; hint?: string };
        console.error(`Query failed: ${e.message ?? String(err)}`);
        if (e.detail) console.error(`  detail: ${e.detail}`);
        if (e.hint) console.error(`  hint: ${e.hint}`);
        process.exitCode = 1;
    } finally {
        await sql.end({ timeout: 5 });
    }
}

void main();

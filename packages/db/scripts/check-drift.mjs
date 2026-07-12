import postgres from 'postgres';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CI passes DATABASE_URL explicitly (dotenv never overrides an existing env
// var); locally, fall back to the web app's .env.local — the single env
// source for all local tooling (docs/guides/environment-setup.md).
config({
    path: join(__dirname, '..', '..', '..', 'apps', 'web', '.env.local'),
});
const journalPath = join(
    __dirname,
    '..',
    'src',
    'migrations',
    'meta',
    '_journal.json'
);
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const expected = journal.entries.length;

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Check apps/web/.env.local exists.');
    process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
try {
    const [{ n: applied }] = await sql`
        SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations
    `;

    if (applied === expected) {
        console.log(`OK: ${applied} migrations applied, matches repo journal.`);
        process.exit(0);
    }

    console.error(
        `DRIFT: repo has ${expected} migrations in _journal.json, DB has ${applied} applied.`
    );
    console.error(
        'Run `pnpm -F db db:migrate` with DATABASE_URL pointed at this database.'
    );
    process.exit(1);
} finally {
    await sql.end();
}

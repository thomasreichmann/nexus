import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
    console.error('DATABASE_URL is not set.');
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
    console.error('Run `pnpm -F db db:migrate` against the prod DB.');
    process.exit(1);
} finally {
    await sql.end();
}

#!/usr/bin/env node
/**
 * `pnpm coverage` — the repo's honest line-coverage number (#492).
 *
 * Runs the unit and integration tiers of web, db and worker with
 * coverage in parallel, merges their coverage-final.json maps, and prints a total plus
 * per-area rows. Every source file counts (each Vitest config has a
 * `coverage.include`), so an untested file drags the number down instead of
 * vanishing from it.
 *
 * The integration tier needs DATABASE_URL (env or apps/web/.env.local). Without
 * it the run is unit-only and the first line says so.
 *
 * Extra args pass through to every Vitest run, e.g.
 *   pnpm coverage --exclude '**\/files.integration.test.ts'
 *
 * Per-tier maps land in coverage/<tier>/ (which `pnpm cov:touched` reuses),
 * the merged one in coverage/coverage-final.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import {
    SKIPPED_DB_NOTICE,
    TIERS,
    color,
    formatFailure,
    hasDatabaseUrl,
    outDir,
    root,
    runTier,
    unparsedFiles,
    unparsedNotice,
} from './coverage/shared.mjs';

const passthrough = process.argv.slice(2);

const WORKSPACES = [
    ['web', (f) => f.startsWith('apps/web/')],
    ['packages/db', (f) => f.startsWith('packages/db/')],
    ['worker', (f) => f.startsWith('apps/worker/')],
];

// The areas the 2026-09-28 baseline tracks (#502). Single-file rows name
// the high-risk code the epic sets out to cover; if one moves, its row says
// so rather than silently reporting nothing.
const AREAS = [
    ['web server/services', (f) => f.startsWith('apps/web/server/services/')],
    [
        'web server/trpc/routers',
        (f) => f.startsWith('apps/web/server/trpc/routers/'),
    ],
    ['web lib/', (f) => f.startsWith('apps/web/lib/')],
    [
        'web app/ api routes',
        (f) => f.startsWith('apps/web/app/') && f.endsWith('/route.ts'),
    ],
    [
        'web app/ pages + layouts',
        (f) => f.startsWith('apps/web/app/') && /\/(page|layout)\.tsx$/.test(f),
    ],
    [
        'web components/ (excl ui/)',
        (f) =>
            f.startsWith('apps/web/components/') &&
            !f.startsWith('apps/web/components/ui/'),
    ],
    ['web scripts/', (f) => f.startsWith('apps/web/scripts/')],
    ['db repositories', (f) => f.startsWith('packages/db/src/repositories/')],
    [
        'upload engine useUpload.ts',
        (f) => f === 'apps/web/components/dashboard/useUpload.ts',
    ],
    [
        'worker generateThumbnail.ts',
        (f) => f === 'apps/worker/src/handlers/generateThumbnail.ts',
    ],
];

const started = Date.now();
const hasDb = hasDatabaseUrl();
const tiers = TIERS.filter((t) => hasDb || !t.needsDb);
const results = await Promise.all(
    tiers.map((tier) =>
        runTier(tier, {
            reportsDir: join(outDir, tier.slug),
            extra: passthrough,
        })
    )
);
const failed = results.filter((r) => r.code !== 0);
const passed = results.filter((r) => r.code === 0);

const map = libCoverage.createCoverageMap({});
for (const r of passed) map.merge(r.map);
const mapped = new Set(map.files().map((f) => relative(root, f)));

const c = color(process.stdout.isTTY ?? false);
const notices = [];
if (!hasDb) notices.push(c.yellow(SKIPPED_DB_NOTICE));
for (const r of failed)
    notices.push(
        c.red(`✗ ${r.tier.name} failed: its coverage is missing below`)
    );
// Harmless when another tier maps the file (the integration tier can't
// transform untouched packages/db files; db unit maps them), but a file no
// tier maps would quietly shrink the denominator.
const dropped = [
    ...new Set(unparsedFiles(results).filter((f) => !mapped.has(f))),
];
if (dropped.length > 0) notices.push(c.yellow(unparsedNotice(dropped)));
if (notices.length) console.log(notices.join('\n'));

if (passed.length > 0) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
        join(outDir, 'coverage-final.json'),
        JSON.stringify(map.toJSON())
    );
    printReport(passed);
}

for (const r of failed)
    console.log(formatFailure(r, c, ['run', ...r.tier.args, ...passthrough]));

const secs = Math.round((Date.now() - started) / 1000);
if (passed.length > 0)
    console.log(c.dim(`merged map: coverage/coverage-final.json · ${secs}s`));
process.exit(failed.length > 0 ? 1 : 0);

function printReport(ran) {
    // The integration tier may reach other packages (allowExternal); only
    // the three workspaces the number is about count.
    const files = map
        .files()
        .map((f) => [relative(root, f), f])
        .filter(([rel]) => WORKSPACES.some(([, match]) => match(rel)));
    const summarize = (match) => {
        const summary = libCoverage.createCoverageSummary();
        let count = 0;
        for (const [rel, abs] of files) {
            if (!match(rel)) continue;
            summary.merge(map.fileCoverageFor(abs).toSummary());
            count++;
        }
        return { lines: summary.lines, count };
    };
    const row = (label, { lines, count }) => {
        const name = label.padEnd(32);
        if (count === 0)
            return `${name} ${c.yellow('no files: its tier failed, or the path moved (update AREAS in scripts/coverage.mjs)')}`;
        const pct = lines.total ? (lines.covered / lines.total) * 100 : 0;
        const files = count === 1 ? '1 file' : `${count} files`;
        return `${name} ${`${pct.toFixed(1)}%`.padStart(6)}  ${`${lines.covered}/${lines.total}`.padStart(10)}  ${c.dim(files)}`;
    };

    const tierNames = ran.map((r) => r.tier.name).join(' + ');
    console.log(c.bold(`Line coverage, all source files (${tierNames})`));
    const total = summarize(() => true);
    console.log(c.bold(row('Total', total)));
    for (const [label, match] of WORKSPACES)
        console.log(row(`  ${label}`, summarize(match)));
    console.log(c.bold('Areas'));
    for (const [label, match] of AREAS)
        console.log(row(`  ${label}`, summarize(match)));
}

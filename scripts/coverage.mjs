#!/usr/bin/env node
/**
 * `pnpm coverage` — the repo's honest line-coverage number (#492).
 *
 * Runs web unit, web integration, packages/db and worker with coverage in
 * parallel, merges their coverage-final.json maps, and prints a total plus
 * per-area rows. Every source file counts (each Vitest config has a
 * `coverage.include`), so an untested file drags the number down instead of
 * vanishing from it.
 *
 * The integration tier needs DATABASE_URL (env or apps/web/.env.local). Without
 * it the run is unit-only and the first line says so.
 *
 * Extra args pass through to every Vitest run, e.g.
 *   pnpm coverage --exclude '**\/publish.integration.test.ts'
 *
 * Per-tier maps land in coverage/<tier>/, the merged one in
 * coverage/coverage-final.json for per-file tooling.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'coverage');
const passthrough = process.argv.slice(2);

const TIERS = [
    { name: 'web unit', slug: 'web-unit', cwd: 'apps/web', args: [] },
    {
        name: 'web integration',
        slug: 'web-integration',
        cwd: 'apps/web',
        args: ['--config', 'vitest.integration.config.ts'],
        needsDb: true,
    },
    { name: 'db unit', slug: 'db-unit', cwd: 'packages/db', args: [] },
    { name: 'worker unit', slug: 'worker-unit', cwd: 'apps/worker', args: [] },
];

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
const results = await Promise.all(tiers.map(runTier));
const failed = results.filter((r) => r.code !== 0);
const passed = results.filter((r) => r.code === 0);

const map = libCoverage.createCoverageMap({});
for (const r of passed) map.merge(r.map);
const mapped = new Set(map.files().map((f) => relative(root, f)));

const c = color(process.stdout.isTTY ?? false);
const notices = [];
if (!hasDb)
    notices.push(
        c.yellow(
            '⚠ web integration skipped (no DATABASE_URL in env or apps/web/.env.local): unit-only coverage, packages/db understated'
        )
    );
for (const r of failed)
    notices.push(
        c.red(`✗ ${r.tier.name} failed: its coverage is missing below`)
    );
// Vitest drops a file it can't transform from its report with only a log
// line. That's harmless when another tier maps the file (the integration
// tier can't transform untouched packages/db files; db unit maps them), but
// a file no tier maps would quietly shrink the denominator.
const dropped = new Set(
    results
        .flatMap((r) =>
            [...r.output.matchAll(/Failed to parse file:\/\/(\S+)\./g)].map(
                (m) => relative(root, m[1])
            )
        )
        .filter((f) => !mapped.has(f))
);
if (dropped.size > 0)
    notices.push(
        c.yellow(
            `⚠ Vitest couldn't parse ${[...dropped].join(', ')}, so it is missing from the total. Usually an unbuilt workspace dependency: run \`pnpm build\` and retry.`
        )
    );
if (notices.length) console.log(notices.join('\n'));

if (passed.length > 0) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
        join(outDir, 'coverage-final.json'),
        JSON.stringify(map.toJSON())
    );
    printReport(passed);
}

for (const r of failed) printFailure(r);

const secs = Math.round((Date.now() - started) / 1000);
if (passed.length > 0)
    console.log(c.dim(`merged map: coverage/coverage-final.json · ${secs}s`));
process.exit(failed.length > 0 ? 1 : 0);

function hasDatabaseUrl() {
    if (process.env.DATABASE_URL) return true;
    try {
        const envFile = readFileSync(join(root, 'apps/web/.env.local'), 'utf8');
        return /^\s*DATABASE_URL\s*=\s*\S/m.test(envFile);
    } catch {
        return false;
    }
}

function runTier(tier) {
    const reportsDir = join(outDir, tier.slug);
    const args = [
        'run',
        ...tier.args,
        '--coverage',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${reportsDir}`,
        ...passthrough,
    ];
    const bin = join(root, tier.cwd, 'node_modules/.bin/vitest');
    return new Promise((resolve) => {
        const proc = spawn(bin, args, {
            cwd: join(root, tier.cwd),
            env: { ...process.env, FORCE_COLOR: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        /** @type {Buffer[]} */
        const chunks = [];
        proc.stdout.on('data', (d) => chunks.push(d));
        proc.stderr.on('data', (d) => chunks.push(d));
        proc.on('error', (err) =>
            resolve({ tier, code: 1, output: err.message })
        );
        proc.on('close', (code) => {
            const output = Buffer.concat(chunks).toString();
            const file = join(reportsDir, 'coverage-final.json');
            if (code !== 0 || !existsSync(file))
                return resolve({ tier, code: code || 1, output });
            const map = libCoverage.createCoverageMap(
                JSON.parse(readFileSync(file, 'utf8'))
            );
            resolve({ tier, code: 0, output, map });
        });
    });
}

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

function printFailure(result) {
    const lines = result.output
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .filter((l) => !isNoise(l.trim()));
    // Vitest's failure section, else the tail (config/startup errors).
    const start = lines.findIndex((l) => /Failed Tests|Failed Suites/.test(l));
    const shown =
        start >= 0 ? lines.slice(start, start + 60) : lines.slice(-30);
    const rerun = ['vitest run', ...result.tier.args, ...passthrough].join(' ');
    console.log(
        `\n${c.red(`${result.tier.name} FAILED`)} ${c.dim(`(rerun: cd ${result.tier.cwd} && pnpm exec ${rerun})`)}`
    );
    console.log(shown.join('\n'));
}

function isNoise(line) {
    return (
        line === '' ||
        /^(✓|RUN\s|Start at|Duration|Coverage enabled|stderr \||stdout \|)/.test(
            line
        ) ||
        // Stack frames inside node_modules or Node internals.
        /^at .*(node_modules|node:internal|<anonymous>)/.test(line) ||
        /^at new Promise/.test(line)
    );
}

function color(enabled) {
    const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
    return {
        red: wrap('31'),
        yellow: wrap('33'),
        dim: wrap('2'),
        bold: wrap('1'),
    };
}

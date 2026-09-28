/**
 * Plumbing shared by `pnpm coverage` (#492) and `pnpm cov:touched` (#493):
 * the four Vitest tiers, which source files each one measures, and running a
 * tier with coverage.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import libCoverage from 'istanbul-lib-coverage';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const outDir = join(root, 'coverage');

// Mirrors each Vitest config's `coverage.include`/`exclude`
// (apps/web/vitest.coverage.ts, `src/**` in db and worker). Keep in step.
const WEB_SOURCE =
    /^apps\/web\/((app|components|lib|server|scripts)\/.+\.tsx?|instrumentation\.ts|proxy\.ts)$/;
const DB_SOURCE = /^packages\/db\/src\/.+\.ts$/;
const WORKER_SOURCE = /^apps\/worker\/src\/.+\.ts$/;
const NOT_SOURCE =
    /(\.test\.tsx?$|\.d\.ts$|\/__tests__\/|(^|\/)(fixtures|mocks|test-utils|testing|vitest\.setup)[^/]*(\/|$))/;

const isWeb = (f) => WEB_SOURCE.test(f) && !NOT_SOURCE.test(f);
const isDb = (f) => DB_SOURCE.test(f) && !NOT_SOURCE.test(f);
const isWorker = (f) => WORKER_SOURCE.test(f) && !NOT_SOURCE.test(f);

/** A repo-relative path that some tier's coverage counts. */
export const isSource = (f) => isWeb(f) || isDb(f) || isWorker(f);

/**
 * `covers`: the source files the tier measures. `inputs`: files whose change
 * invalidates the tier's cached coverage (its tests, config and setup).
 */
export const TIERS = [
    {
        name: 'web unit',
        kind: 'unit',
        slug: 'web-unit',
        cwd: 'apps/web',
        args: [],
        covers: isWeb,
        inputs: (f) =>
            (/^apps\/web\/.+\.test\.tsx?$/.test(f) &&
                !f.includes('.integration.test.') &&
                !f.startsWith('apps/web/e2e/')) ||
            /^apps\/web\/vitest\.(config|coverage|setup)\.ts$/.test(f),
    },
    {
        name: 'web integration',
        kind: 'integration',
        slug: 'web-integration',
        cwd: 'apps/web',
        args: ['--config', 'vitest.integration.config.ts'],
        needsDb: true,
        covers: (f) => isWeb(f) || isDb(f),
        inputs: (f) =>
            /^apps\/web\/.+\.integration\.test\.ts$/.test(f) ||
            /^apps\/web\/vitest\.(integration\.config|integration\.setup|coverage)\.ts$/.test(
                f
            ),
    },
    {
        name: 'db unit',
        kind: 'unit',
        slug: 'db-unit',
        cwd: 'packages/db',
        args: [],
        covers: isDb,
        inputs: (f) =>
            (/^packages\/db\/src\/.+\.test\.ts$/.test(f) &&
                !f.includes('.integration.test.')) ||
            f === 'packages/db/vitest.config.ts',
    },
    {
        name: 'db integration',
        kind: 'integration',
        slug: 'db-integration',
        cwd: 'packages/db',
        args: ['--config', 'vitest.integration.config.ts'],
        needsDb: true,
        covers: isDb,
        inputs: (f) =>
            /^packages\/db\/src\/.+\.integration\.test\.ts$/.test(f) ||
            /^packages\/db\/(vitest\.config|vitest\.integration\.config|vitest\.integration\.setup)\.ts$/.test(
                f
            ) ||
            f === 'packages/db/src/test-db/integration.ts',
    },
    {
        name: 'worker unit',
        kind: 'unit',
        slug: 'worker-unit',
        cwd: 'apps/worker',
        args: [],
        covers: isWorker,
        inputs: (f) =>
            /^apps\/worker\/src\/.+\.test\.ts$/.test(f) ||
            f === 'apps/worker/vitest.config.ts',
    },
];

export function hasDatabaseUrl() {
    if (process.env.DATABASE_URL) return true;
    try {
        const envFile = readFileSync(join(root, 'apps/web/.env.local'), 'utf8');
        return /^\s*DATABASE_URL\s*=\s*\S/m.test(envFile);
    } catch {
        return false;
    }
}

export const SKIPPED_DB_NOTICE =
    '⚠ integration tiers skipped (no DATABASE_URL in env or apps/web/.env.local): unit-only coverage, packages/db understated';

/**
 * Run one tier's Vitest with a json coverage report into `reportsDir`.
 * Resolves `{ tier, code, output, map }`; `map` is null when the run failed
 * (Vitest writes no coverage when a test fails).
 */
export function runTier(tier, { reportsDir, before = ['run'], extra = [] }) {
    const args = [
        ...before,
        ...tier.args,
        '--coverage',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${reportsDir}`,
        ...extra,
    ];
    const bin = join(root, tier.cwd, 'node_modules/.bin/vitest');
    const started = Date.now();
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
        const done = (code, output, map = null) =>
            resolve({
                tier,
                code,
                output,
                map,
                seconds: (Date.now() - started) / 1000,
            });
        proc.on('error', (err) => done(1, err.message));
        proc.on('close', (code) => {
            const output = Buffer.concat(chunks).toString();
            const file = join(reportsDir, 'coverage-final.json');
            if (code !== 0 || !existsSync(file)) return done(code || 1, output);
            done(0, output, loadMap(file));
        });
    });
}

export function loadMap(file) {
    return libCoverage.createCoverageMap(
        JSON.parse(readFileSync(file, 'utf8'))
    );
}

/**
 * Files Vitest logged as unparseable. It drops them from its report with
 * only that log line (usually an unbuilt workspace dependency).
 */
export function unparsedFiles(results) {
    return results.flatMap((r) =>
        [...r.output.matchAll(/Failed to parse file:\/\/(\S+)\./g)].map((m) =>
            relative(root, m[1])
        )
    );
}

export const unparsedNotice = (files) =>
    `⚠ Vitest couldn't parse ${files.join(', ')}, so it is missing from the report. Usually an unbuilt workspace dependency: run \`pnpm build\` and retry.`;

/** The actionable part of a failed tier's output, with a rerun command. */
export function formatFailure(result, c, rerunArgs) {
    const lines = result.output
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .filter((l) => !isNoise(l.trim()));
    // Vitest's failure section, else the tail (config/startup errors).
    const start = lines.findIndex((l) => /Failed Tests|Failed Suites/.test(l));
    const shown =
        start >= 0 ? lines.slice(start, start + 60) : lines.slice(-30);
    const rerun = ['vitest', ...rerunArgs].join(' ');
    return [
        `\n${c.red(`${result.tier.name} FAILED`)} ${c.dim(`(rerun: cd ${result.tier.cwd} && pnpm exec ${rerun})`)}`,
        ...shown,
    ].join('\n');
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

export function color(enabled) {
    const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
    return {
        red: wrap('31'),
        yellow: wrap('33'),
        green: wrap('32'),
        dim: wrap('2'),
        bold: wrap('1'),
    };
}

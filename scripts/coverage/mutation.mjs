/**
 * Mutation testing for a set of source files (#494), shared by `pnpm mutate`
 * and `pnpm cov:touched --mutate`: Stryker with its Vitest runner.
 *
 * Why it's shaped like this (each point was found by breaking it):
 *
 * - One Stryker run over a generated Vitest `projects` config holding every
 *   tier, so each mutant is judged by every test that executes it: a
 *   repository mutant by the db integration tests and by the web service
 *   tests over it alike.
 * - In place, not in Stryker's sandbox copy. In the sandbox, apps/web
 *   resolves `@nexus/db` through its node_modules symlink to the real,
 *   unmutated package, so no web test could kill a db mutant. In place, the
 *   files hold Stryker's instrumentation for the length of the run. Stryker
 *   restores them (on Ctrl-C too), and `restore()` below double-checks.
 * - `disableBail`: with bail, Vitest 4 loses the failing file's results when
 *   it cancels the rest, and Stryker reports a killed mutant as survived.
 * - `maxConcurrency: 1` on each project: Stryker attributes coverage to "the
 *   test running now", so `describe.concurrent` suites put it on the wrong
 *   test and results changed from run to run. Stryker sets it on the root
 *   config, which projects don't inherit.
 * - A plain `vitest related` run first: Stryker silently skips a test file
 *   that fails to import, so its mutants would read as survivors.
 * - A throwaway Postgres (`scripts/throwaway-postgres.mjs`): each mutant
 *   re-runs the integration tests that cover it, ~10x faster locally than
 *   over the dev pooler, and nobody else's rows.
 * - Our own mutator, `DrizzleCondition` (`drizzle-condition.mjs`, #524):
 *   one `and()`/`or()` term, or a builder's whole `.where(…)`, dropped. No
 *   built-in mutator makes these, and Stryker 10 has no mutator plugin
 *   kind. `stryker-plugin.mjs` appends it to the instrumenter's built-in
 *   list at run time, from an Ignore plugin. So its mutants get everything
 *   Stryker's get: mutation switching, per-test coverage and `killedBy`,
 *   `// Stryker disable` comments, report.json and the HTML report, and
 *   `summarize()` below. The alternatives cost more:
 *   - A `pnpm patch` of the instrumenter adding it to `allMutators` gets the
 *     same, but the mutator then lives in a diff of Stryker's dist code, and
 *     reaches into the same internals anyway.
 *   - A companion pass (write each variant, run its tests) is one Vitest
 *     run per mutant, and re-implements per-test attribution and reports.
 *   - Rewriting the source so a built-in mutator makes the drop needs every
 *     reported line, column and `original` mapped back.
 *   The cost of the plugin: it relies on `allMutators` and the NodeMutator
 *   shape, which aren't public API. If a Stryker upgrade moves them, the
 *   run fails and says so; it never quietly measures without the mutants.
 */
import { spawn } from 'node:child_process';
import {
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { withThrowawayPostgres } from '../throwaway-postgres.mjs';
import { NAME as DRIZZLE_CONDITION } from './drizzle-condition.mjs';
import { TIERS, formatFailure, outDir, root } from './shared.mjs';

export const mutationDir = join(outDir, 'mutation');
export const reportHtml = join(mutationDir, 'mutation.html');
const reportJson = join(mutationDir, 'report.json');
const relatedJson = join(mutationDir, 'related.json');
const cacheFile = join(mutationDir, 'cache.json');
// Stryker's helper name in instrumented code: a file holding it is left over
// from a run that was killed before it could restore.
const INSTRUMENTED = 'stryNS_9fa48';
// Each Stryker worker opens its own pools, beyond Postgres's default 100.
const PG_FLAGS = ['-c', 'max_connections=500'];
const STRYKER_PLUGIN = join(root, 'scripts/coverage/stryker-plugin.mjs');
// A change to what our mutator generates re-measures every file.
const OWN_MUTATORS = 'scripts/coverage/drizzle-condition.mjs';

/** Every tier, minus the integration ones with `unitOnly`. */
export function mutationTiers({ unitOnly = false } = {}) {
    return TIERS.filter((t) => !(t.needsDb && unitOnly));
}

/**
 * Cached results that are still fresh: newer than the file, than every test
 * and config of the tiers and than our mutator, and measured with at least
 * those tiers.
 */
export function cachedMutation(files, tiers, allFiles) {
    const inputsAt = Math.max(
        mtime(OWN_MUTATORS),
        ...allFiles.filter((f) => tiers.some((t) => t.inputs(f))).map(mtime)
    );
    const names = tiers.map((t) => t.name);
    const cache = readCache();
    const fresh = new Map();
    for (const f of files) {
        const entry = cache.files[f];
        if (
            entry &&
            entry.at > Math.max(mtime(f), inputsAt) &&
            names.every((n) => entry.tiers.includes(n)) &&
            // Cached before the per-test tally (#498) or DrizzleCondition
            // (#524) existed: measure again.
            Array.isArray(entry.result.tests) &&
            entry.result.byMutator
        )
            fresh.set(f, entry.result);
    }
    return fresh;
}

/**
 * Mutation-test `files` (repo-relative source paths), re-running only those
 * without a fresh cached result (all of them with `rerun`).
 *
 * Resolves `{ results, tiers, ran, notices, failure, seconds }`: `results`
 * maps each path to its result (see `summarize`), `ran` lists the files
 * Stryker mutated this time, and `failure` is set when the tests were red or
 * Stryker failed, in which case the stale files have no result.
 * `dbFromEnv` uses DATABASE_URL as it is (CI's service container) instead of
 * a throwaway Postgres. `onProgress(text)` gets Stryker's progress lines.
 */
export async function runMutation(
    files,
    { unitOnly = false, dbFromEnv = false, rerun = false, allFiles, onProgress }
) {
    const started = Date.now();
    const tiers = mutationTiers({ unitOnly });
    const results = rerun ? new Map() : cachedMutation(files, tiers, allFiles);
    const stale = files.filter((f) => !results.has(f));
    const outcome = { results, tiers, ran: stale, notices: [], failure: null };
    if (unitOnly)
        outcome.notices.push(
            '⚠ --unit-only: integration tiers not run, so mutants only a real-DB test would catch read as survivors'
        );
    if (stale.length === 0) return finish(outcome, started);

    const leftovers = stale.filter((f) =>
        readFileSync(join(root, f), 'utf8').includes(INSTRUMENTED)
    );
    if (leftovers.length > 0) {
        outcome.failure = `Stryker's instrumentation is still in ${leftovers.join(', ')}, from an interrupted run. Restore the file (git, or the backup under ${relative(root, mutationDir)}/tmp) and rerun.`;
        return finish(outcome, started);
    }

    clearRunLeftovers();
    mkdirSync(mutationDir, { recursive: true });
    const vitestConfig = writeProjectsConfig(tiers);
    // A test that sends real SQS messages (publish.integration.test.ts) has
    // no business running once per mutant.
    const baseEnv = { INTEGRATION_SKIP_AWS: '1' };
    const measure = (dbEnv) =>
        mutate(
            stale,
            vitestConfig,
            tiers,
            { ...baseEnv, ...dbEnv },
            onProgress
        );

    // Ctrl-C reaches Stryker and Vitest directly (they restore the files and
    // exit); staying alive lets the throwaway Postgres be stopped and deleted.
    const ignoreSigint = () => {};
    process.on('SIGINT', ignoreSigint);
    try {
        let measured;
        if (unitOnly || dbFromEnv) {
            if (dbFromEnv && !process.env.DATABASE_URL)
                measured = {
                    failure: '--db-from-env: DATABASE_URL is not set',
                };
            else measured = await measure({});
        } else {
            measured = await withThrowawayPostgres(({ env }) => measure(env), {
                quiet: true,
                postgresFlags: PG_FLAGS,
            });
            if (typeof measured === 'number')
                measured = {
                    failure:
                        'the throwaway Postgres failed to start or migrate',
                };
        }
        if (measured.failure) outcome.failure = measured.failure;
        else {
            const cache = readCache();
            const at = Date.now();
            const names = tiers.map((t) => t.name);
            for (const [f, result] of measured.results) {
                results.set(f, result);
                cache.files[f] = { at, tiers: names, result };
            }
            writeFileSync(cacheFile, JSON.stringify(cache));
        }
    } finally {
        process.off('SIGINT', ignoreSigint);
        clearRunLeftovers();
    }
    return finish(outcome, started);
}

/**
 * Stryker's backups (the files are clean by now, so they're stale) and the
 * setup file each Vitest worker writes into the cwd and only removes when it
 * shuts down cleanly. A Ctrl-C leaves both; embedded-postgres's exit hook
 * ends the process then, so the next run clears them too.
 */
function clearRunLeftovers() {
    rmSync(join(mutationDir, 'tmp'), { recursive: true, force: true });
    for (const f of readdirSync(root))
        if (/^stryker-setup-\d+\.js$/.test(f))
            rmSync(join(root, f), { force: true });
}

function finish(outcome, started) {
    return { ...outcome, seconds: (Date.now() - started) / 1000 };
}

async function mutate(files, vitestConfig, tiers, env, onProgress) {
    // 1. The tests must pass as they are, and every related file must load.
    rmSync(relatedJson, { force: true });
    const related = await spawnLogged(
        join(root, 'apps/web/node_modules/.bin/vitest'),
        [
            'related',
            ...files.map((f) => join(root, f)),
            '--run',
            '--passWithNoTests',
            '--config',
            vitestConfig,
            '--reporter=default',
            '--reporter=json',
            `--outputFile.json=${relatedJson}`,
        ],
        env
    );
    if (related.code !== 0) {
        const tierDir = join(root, 'apps/web');
        return {
            failure: formatFailure(
                {
                    tier: { name: 'tests', cwd: 'apps/web' },
                    output: related.output,
                },
                { red: (s) => s, dim: (s) => s },
                [
                    'related',
                    ...files.map((f) => relative(tierDir, join(root, f))),
                    '--run',
                    '--config',
                    relative(tierDir, vitestConfig),
                ]
            ).replace(/^\n/, ''),
        };
    }
    const testCount = JSON.parse(
        readFileSync(relatedJson, 'utf8')
    ).numTotalTests;
    // Stryker refuses to run without tests; every mutant would be unreached.
    if (testCount === 0)
        return { results: new Map(files.map((f) => [f, noTestsResult()])) };

    // 2. Stryker, in place. Keep the originals to check the restore.
    const originals = files.map((f) => {
        const abs = join(root, f);
        return { abs, text: readFileSync(abs, 'utf8'), stat: statSync(abs) };
    });
    const strykerConfig = join(mutationDir, 'stryker.config.json');
    writeFileSync(
        strykerConfig,
        JSON.stringify(strykerOptions(files, vitestConfig), null, 4)
    );
    rmSync(reportJson, { force: true });
    let run;
    try {
        run = await spawnLogged(
            join(root, 'node_modules/.bin/stryker'),
            ['run', strykerConfig],
            env,
            (line) => {
                const m = line.match(/(\d+)\/(\d+) tested \((\d+) survived/);
                if (m && onProgress)
                    onProgress(
                        `${m[1]}/${m[2]} mutants tested, ${m[3]} survived`
                    );
            }
        );
    } finally {
        restore(originals);
    }
    if (run.code !== 0) {
        const lines = run.output
            .replace(/\x1b\[[0-9;]*m/g, '')
            .trim()
            .split('\n');
        return {
            failure: [
                `Stryker failed (config: ${relative(root, strykerConfig)}):`,
                ...lines.slice(-30),
            ].join('\n'),
        };
    }
    const report = JSON.parse(readFileSync(reportJson, 'utf8'));
    const tests = testNames(report);
    return {
        results: new Map(
            files.map((f) => [f, summarize(report.files[f], tests)])
        ),
        tiers,
    };
}

function strykerOptions(files, vitestConfig) {
    return {
        testRunner: 'vitest',
        plugins: ['@stryker-mutator/vitest-runner', STRYKER_PLUGIN],
        // Creating this "ignorer" adds DrizzleCondition; it ignores nothing.
        ignorers: [DRIZZLE_CONDITION],
        vitest: { configFile: vitestConfig, related: true },
        coverageAnalysis: 'perTest',
        inPlace: true,
        disableBail: true,
        // It would add `// @ts-nocheck` to files, in place; Vitest doesn't
        // type-check anyway.
        disableTypeChecks: false,
        mutate: files,
        reporters: ['json', 'html', 'progress-append-only'],
        jsonReporter: { fileName: reportJson },
        htmlReporter: { fileName: reportHtml },
        tempDirName: relative(root, join(mutationDir, 'tmp')),
        cleanTempDir: true,
        concurrency: Math.max(1, Math.min(8, availableParallelism() - 1)),
        fileLogLevel: 'off',
        warnings: { slow: false },
        // Stryker lists every file under the cwd before it starts; these are
        // big, and never mutated.
        ignorePatterns: [
            '/coverage',
            '.next',
            '.turbo',
            'dist',
            'test-results',
            'playwright-report',
            'coverage-integration',
        ],
    };
}

/**
 * Every tier as one Vitest config. Each project extends its tier's own config
 * and root, so setup files, environments and aliases are the tier's.
 */
function writeProjectsConfig(tiers) {
    const projects = tiers.map((tier) => {
        const i = tier.args.indexOf('--config');
        const config = i >= 0 ? tier.args[i + 1] : 'vitest.config.ts';
        return {
            extends: join(root, tier.cwd, config),
            root: join(root, tier.cwd),
            test: { name: tier.name, maxConcurrency: 1 },
        };
    });
    const file = join(mutationDir, 'vitest.projects.mjs');
    writeFileSync(
        file,
        `// Generated by scripts/coverage/mutation.mjs: every tier in one Vitest run.\nexport default ${JSON.stringify({ test: { projects } }, null, 4)};\n`
    );
    return file;
}

/**
 * Put back any file Stryker didn't restore, and every file's mtime, so
 * `pnpm cov:touched` doesn't see the run as an edit.
 */
function restore(originals) {
    for (const { abs, text, stat } of originals) {
        if (readFileSync(abs, 'utf8') !== text) {
            writeFileSync(abs, text);
            console.error(
                `⚠ restored ${relative(root, abs)}: Stryker left it instrumented`
            );
        }
        utimesSync(abs, stat.atime, stat.mtime);
    }
}

function spawnLogged(bin, args, env, onLine) {
    return new Promise((resolve) => {
        const proc = spawn(bin, args, {
            cwd: root,
            env: { ...process.env, ...env, FORCE_COLOR: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        /** @type {Buffer[]} */
        const chunks = [];
        const take = (d) => {
            chunks.push(d);
            if (onLine)
                for (const line of d.toString().split('\n')) onLine(line);
        };
        proc.stdout.on('data', take);
        proc.stderr.on('data', take);
        const done = (code) =>
            resolve({ code, output: Buffer.concat(chunks).toString() });
        proc.on('error', (err) => {
            chunks.push(Buffer.from(err.message));
            done(1);
        });
        proc.on('close', (code, signal) => done(signal ? 1 : (code ?? 1)));
    });
}

/** Test id → its label (`basename › title`) and its repo-relative file. */
function testNames(report) {
    const names = new Map();
    for (const [file, { tests }] of Object.entries(report.testFiles ?? {}))
        for (const t of tests)
            names.set(t.id, {
                label: `${basename(file)} › ${t.name}`,
                file: relative(root, resolve(root, file)),
            });
    return names;
}

function noTestsResult() {
    return {
        tested: false,
        score: null,
        killed: 0,
        survived: 0,
        noCoverage: null,
        total: null,
        survivors: [],
        noCoverageLines: [],
        tests: [],
        byMutator: {},
    };
}

/**
 * One file's result. `killed` counts Stryker's Killed and Timeout, `total`
 * is killed + survived + noCoverage (compile/runtime errors and ignored
 * mutants don't count), and `score` is killed / total in percent.
 *
 * `tests` is each test's own tally over the file's mutants: how many it ran
 * and how many turned it red, weakest first. With `disableBail` every
 * covering test runs, so `killedBy` names every test that noticed. Static
 * mutants (every related test "runs" them) are left out. A timeout names no
 * test, so it's counted apart, in `timedOut`, for each test that covers it.
 *
 * `byMutator` splits killed, survived and noCoverage by mutator name. A
 * DrizzleCondition survivor also gets a `description` of what it dropped.
 */
function summarize(entry, tests) {
    const result = {
        tested: true,
        score: null,
        killed: 0,
        survived: 0,
        noCoverage: 0,
        total: 0,
        survivors: [],
        noCoverageLines: [],
        tests: [],
        byMutator: {},
    };
    if (!entry) return result;
    const source = entry.source.split('\n');
    const unreached = [];
    const perTest = new Map();
    for (const m of entry.mutants) {
        const kind = STATUS_KIND[m.status];
        if (kind) {
            result.byMutator[m.mutatorName] ??= {
                killed: 0,
                survived: 0,
                noCoverage: 0,
            };
            result.byMutator[m.mutatorName][kind]++;
        }
        if (!m.static && ['Killed', 'Survived', 'Timeout'].includes(m.status))
            for (const id of m.coveredBy ?? []) {
                const t = perTest.get(id) ?? { ran: 0, killed: 0, timedOut: 0 };
                if (m.status === 'Timeout') t.timedOut++;
                else {
                    t.ran++;
                    if (m.killedBy?.includes(id)) t.killed++;
                }
                perTest.set(id, t);
            }
        if (m.status === 'Killed' || m.status === 'Timeout') result.killed++;
        else if (m.status === 'Survived') {
            result.survived++;
            result.survivors.push({
                line: m.location.start.line,
                column: m.location.start.column,
                mutator: m.mutatorName,
                ...(m.mutatorName === DRIZZLE_CONDITION && {
                    description: dropped(source, m.location),
                }),
                original: snippet(originalText(source, m.location)),
                replacement: snippet(m.replacement ?? ''),
                static: Boolean(m.static),
                coveredBy: (m.coveredBy ?? []).map(
                    (id) => tests.get(id)?.label ?? id
                ),
            });
        } else if (m.status === 'NoCoverage') {
            result.noCoverage++;
            unreached.push([m.location.start.line, m.location.end.line]);
        }
    }
    result.total = result.killed + result.survived + result.noCoverage;
    result.score = result.total
        ? Math.round((result.killed / result.total) * 1000) / 10
        : null;
    result.survivors.sort((a, b) => a.line - b.line || a.column - b.column);
    result.noCoverageLines = mergeRanges(unreached);
    result.tests = [...perTest]
        .map(([id, t]) => ({
            test: tests.get(id)?.label ?? id,
            file: tests.get(id)?.file ?? null,
            ...t,
        }))
        .sort((a, b) => ratio(a) - ratio(b) || a.test.localeCompare(b.test));
    return result;
}

const STATUS_KIND = {
    Killed: 'killed',
    Timeout: 'killed',
    Survived: 'survived',
    NoCoverage: 'noCoverage',
};

/**
 * A DrizzleCondition mutant replaces a condition with `undefined`: the
 * argument of a builder's `.where(`, or one term of an `and(` / `or(`.
 */
function dropped(source, { start }) {
    const before = [
        ...source.slice(Math.max(0, start.line - 4), start.line - 1),
        source[start.line - 1].slice(0, start.column - 1),
    ].join('\n');
    return /\.where\(\s*$/.test(before)
        ? 'the whole .where(…) dropped'
        : 'one and()/or() term dropped';
}

// A test whose only mutants timed out sorts with the strongest.
function ratio(t) {
    return t.ran ? t.killed / t.ran : 1;
}

function originalText(source, { start, end }) {
    if (start.line === end.line)
        return source[start.line - 1].slice(start.column - 1, end.column - 1);
    return [
        source[start.line - 1].slice(start.column - 1),
        ...source.slice(start.line, end.line - 1),
        source[end.line - 1].slice(0, end.column - 1),
    ].join('\n');
}

function snippet(text, max = 60) {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function mergeRanges(ranges) {
    const merged = [];
    for (const [a, b] of ranges.sort((x, y) => x[0] - y[0])) {
        const last = merged.at(-1);
        if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
        else merged.push([a, b]);
    }
    return merged;
}

function readCache() {
    try {
        return JSON.parse(readFileSync(cacheFile, 'utf8'));
    } catch {
        return { files: {} };
    }
}

function mtime(f) {
    try {
        return statSync(join(root, f)).mtimeMs;
    } catch {
        return 0;
    }
}

#!/usr/bin/env node
/**
 * `pnpm cov:touched` — how well is the code I just touched protected? (#493)
 *
 *   pnpm cov:touched                  files changed vs main (merge base)
 *   pnpm cov:touched lib/upload/*.ts  …plus these files, dirs or globs
 *   pnpm cov:touched --only <paths>   exactly these instead
 *   pnpm cov:touched --all            every source file
 *   --risk          churn × coverage ranking instead (git log, --days 90)
 *   --limit N       rows to show with --risk --all (default 20)
 *   --unit-only     skip the integration tiers (web's costs ~50s when stale)
 *   --base <ref>    compare against <ref> instead of origin/main
 *   --json          machine-readable output (schema in docs/conventions/testing.md)
 *
 * Coverage comes from the per-tier maps `pnpm coverage` writes, plus a cache
 * of earlier runs of this command. A file's entry is fresh when it's newer
 * than the file and than every test/config input of its tier; for stale
 * files only, each affected tier re-runs `vitest related`, so only the tests
 * that import them run, with coverage scoped to them.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import { e2eReachedFiles } from './e2e.mjs';
import {
    changedFiles,
    churn,
    defaultBaseRef,
    expandPaths,
    repoFiles,
} from './files.mjs';
import {
    SKIPPED_DB_NOTICE,
    TIERS,
    color,
    formatFailure,
    hasDatabaseUrl,
    isSource,
    loadMap,
    outDir,
    root,
    runTier,
    unparsedFiles,
    unparsedNotice,
} from './shared.mjs';

const started = Date.now();
const opts = parseArgs(process.argv.slice(2));
const c = color(!opts.json && (process.stdout.isTTY ?? false));
const notices = [];

// ── Which files ────────────────────────────────────────────────────────
const allFiles = repoFiles();
let scope;
let base = null;
if (opts.all) scope = allFiles;
else {
    const named = expandPaths(opts.paths, allFiles);
    for (const arg of named.unmatched) notices.push(`⚠ no such file: ${arg}`);
    if (opts.only) scope = named.files;
    else {
        const changed = changedFiles(opts.base);
        base = changed.base;
        scope = [...changed.files, ...named.files];
    }
}
const files = [...new Set(scope)].filter(isSource).sort();

// ── Coverage: cached where fresh, `vitest related` where stale ─────────
const hasDb = !opts.unitOnly && hasDatabaseUrl();
if (!opts.unitOnly && !hasDb) notices.push(SKIPPED_DB_NOTICE);
if (opts.unitOnly)
    notices.push('⚠ --unit-only: integration tiers not consulted');
const tiers = TIERS.filter((t) => !t.needsDb || hasDb);
const cacheDir = join(outDir, 'touched');
const mtime = (f) => {
    try {
        return statSync(join(root, f)).mtimeMs;
    } catch {
        return 0;
    }
};

const tierState = await Promise.all(
    tiers.map(async (tier) => {
        const mine = files.filter(tier.covers);
        const inputsAt = Math.max(
            0,
            ...allFiles.filter(tier.inputs).map(mtime)
        );
        const cache = readCache(tier);
        const full = readFull(tier);
        // `data: null` means the tier ran and never loaded the file: Vitest
        // leaves out an included file it couldn't transform, which is what
        // happens to packages/db files no integration test imports.
        const entryFor = (f) => {
            const fromFull =
                full.files[f] ?? (full.at ? { at: full.at, data: null } : null);
            const known = [cache.files[f], fromFull]
                .filter(Boolean)
                .sort((a, b) => b.at - a.at);
            const fresh = known.find(
                (e) => e.at > Math.max(mtime(f), inputsAt)
            );
            if (fresh) return fresh;
            // An integration tier costs up to ~50s of Postgres round trips. If
            // its tests haven't changed since it last found this file
            // unexecuted, editing the file won't make them execute it:
            // carry "not reached" forward instead of re-running.
            const last = known[0];
            if (
                tier.needsDb &&
                last &&
                last.at > inputsAt &&
                !(last.data && Object.values(last.data.s).some((n) => n > 0))
            )
                return { at: last.at, data: null };
            return undefined;
        };
        const stale = mine.filter((f) => !entryFor(f));
        let run = null;
        if (stale.length > 0) {
            const reportsDir = join(cacheDir, `.run-${tier.slug}`);
            run = await runTier(tier, {
                reportsDir,
                before: ['related', ...stale.map((f) => join(root, f))],
                extra: [
                    '--run',
                    '--passWithNoTests',
                    ...stale.map((f) => `--coverage.include=${join(root, f)}`),
                ],
            });
            if (run.map) {
                const at = Date.now();
                const mapped = new Map(
                    run.map
                        .files()
                        .map((abs) => [abs.slice(root.length + 1), abs])
                );
                for (const f of stale) {
                    const abs = mapped.get(f);
                    cache.files[f] = {
                        at,
                        data: abs
                            ? run.map.fileCoverageFor(abs).toJSON()
                            : null,
                    };
                }
                writeCache(tier, cache);
            }
        }
        const entries = new Map(mine.map((f) => [f, entryFor(f)]));
        return { tier, mine, stale, run, entries };
    })
);

const failedRuns = tierState.map((s) => s.run).filter((r) => r && r.code !== 0);
for (const r of failedRuns)
    notices.push(`✗ ${r.tier.name} failed: its coverage is missing below`);
const unparsed = unparsedFiles(tierState.map((s) => s.run).filter(Boolean));

// ── Per-file records ───────────────────────────────────────────────────
const records = files.map((path) => {
    const fc = libCoverage.createCoverageMap({});
    const kinds = new Set();
    for (const { tier, entries } of tierState) {
        const data = entries.get(path)?.data;
        if (!data) continue;
        fc.addFileCoverage(data);
        if (Object.values(data.s).some((n) => n > 0)) kinds.add(tier.kind);
    }
    if (fc.files().length === 0) return { path, status: 'unmeasured' };
    const cov = fc.fileCoverageFor(fc.files()[0]);
    const summary = cov.toSummary();
    return {
        path,
        lines: metric(summary.lines),
        branches: metric(summary.branches),
        uncovered: uncoveredRanges(cov),
        tiers: ['unit', 'integration'].filter((k) => kinds.has(k)),
    };
});
for (const f of unparsed)
    if (records.some((r) => r.path === f && r.status === 'unmeasured'))
        notices.push(unparsedNotice([f]));

// Each enricher adds fields to every record. The mutation step (#494) plugs
// in here as one more enricher (e.g. `mutation: { killed, total }`).
const ENRICHERS = [addE2e, addChurn, addStatus];
for (const enrich of ENRICHERS) enrich(records);

// ── Output ─────────────────────────────────────────────────────────────
const seconds = (Date.now() - started) / 1000;
const tierSummary = tierState.map(({ tier, mine, stale, run }) => ({
    name: tier.name,
    status: !run
        ? mine.length
            ? 'fresh'
            : 'unused'
        : run.code === 0
          ? 'ran'
          : 'failed',
    files: mine.length,
    rerun: stale.length,
    seconds: run ? Math.round(run.seconds * 10) / 10 : 0,
    ...(run && run.code !== 0
        ? { failure: failureText(run, color(false)) }
        : {}),
}));

if (opts.json) {
    const sorted = opts.risk ? byRisk(records) : byWorst(records);
    console.log(
        JSON.stringify(
            {
                version: 1,
                mode: opts.all ? 'all' : opts.only ? 'only' : 'changed',
                base,
                riskWindowDays: opts.days,
                seconds,
                tiers: tierSummary,
                notices,
                files:
                    opts.risk && opts.all
                        ? sorted.slice(0, opts.limit)
                        : sorted,
            },
            null,
            2
        )
    );
} else printText();

process.exit(failedRuns.length > 0 ? 1 : 0);

// ───────────────────────────────────────────────────────────────────────

function printText() {
    for (const n of notices)
        console.log(n.startsWith('✗') ? c.red(n) : c.yellow(n));
    if (files.length === 0) {
        console.log(
            opts.all || opts.only
                ? 'No source files in the given paths.'
                : `No source files changed vs ${opts.base} (${base.slice(0, 7)}). Name files to check, or use --all.`
        );
        return;
    }
    if (opts.risk) printRisk();
    else printFiles();
    for (const r of failedRuns) console.log(failureText(r, c));
    const hint = opts.all ? null : hints(records);
    if (hint) console.log(c.dim(hint));
    const ran = tierSummary
        .filter((t) => t.status === 'ran' || t.status === 'failed')
        .map((t) => `${t.name} ${t.status} ${t.seconds}s`);
    const scopeLabel = opts.all
        ? 'all source files'
        : opts.only
          ? 'named files'
          : `changed vs ${opts.base} ${base.slice(0, 7)}`;
    console.log(
        c.dim(
            `${files.length === 1 ? '1 file' : `${files.length} files`}, ${scopeLabel} · ${ran.length ? ran.join(', ') : 'cached coverage'} · ${seconds.toFixed(1)}s`
        )
    );
}

function printFiles() {
    for (const r of byWorst(records)) {
        if (r.status === 'unmeasured') {
            console.log(`   —      —            ${label(r)}  ${r.path}`);
            continue;
        }
        const ranges = r.uncovered.length
            ? c.dim(`  L${formatRanges(r.uncovered)}`)
            : '';
        console.log(
            `${pct(r.lines)} ${pct(r.branches)}  ${`${r.lines.covered}/${r.lines.total}`.padStart(9)}  ${label(r)}  ${r.path}${ranges}`
        );
    }
}

function printRisk() {
    const ranked = byRisk(records).filter((r) => r.status !== 'no-code');
    const shown = opts.all ? ranked.slice(0, opts.limit) : ranked;
    for (const r of shown) {
        const lines = r.lines ? pct(r.lines) : '     —';
        console.log(
            `${r.risk.toFixed(1).padStart(6)}  ${String(r.churn).padStart(3)} commits  ${lines}  ${label(r)}  ${r.path}`
        );
    }
    if (shown.length < ranked.length)
        console.log(
            c.dim(
                `top ${shown.length} of ${ranked.length} (--limit N for more)`
            )
        );
    console.log(
        c.dim(
            `risk = commits in ${opts.days}d × uncovered line share; e2e-only counts as uncovered`
        )
    );
}

function failureText(run, paint) {
    const tierDir = join(root, run.tier.cwd);
    const stale = tierState
        .find((s) => s.run === run)
        .stale.map((f) => relative(tierDir, join(root, f)));
    return formatFailure(run, paint, [
        'related',
        ...stale,
        '--run',
        ...run.tier.args,
    ]);
}

function label(r) {
    const text =
        r.status === 'covered' || r.status === 'partial'
            ? r.tiers.join('+') + (r.e2e ? '+e2e' : '')
            : r.status;
    const painted =
        r.status === 'untested'
            ? c.red(text)
            : r.status === 'e2e-only'
              ? c.yellow(text)
              : text;
    return painted + ' '.repeat(Math.max(0, 22 - text.length));
}

function hints(recs) {
    const repoGap = recs.some(
        (r) =>
            r.path.startsWith('packages/db/src/repositories/') &&
            (r.status === 'untested' ||
                r.status === 'e2e-only' ||
                (r.status === 'partial' && !r.tiers.includes('integration')))
    );
    if (!repoGap) return null;
    return 'hint: test repository code against the real DB, never a fake: an x.integration.test.ts next to it, using the fixtures in @nexus/db/test-db/integration. See "Integration Tests (real database)" in docs/conventions/testing.md.';
}

// ── Enrichers ──────────────────────────────────────────────────────────

function addE2e(recs) {
    const reached = e2eReachedFiles();
    for (const r of recs) r.e2e = reached.has(r.path);
}

function addChurn(recs) {
    const counts = churn(opts.days);
    for (const r of recs) {
        r.churn = counts.get(r.path) ?? 0;
        const uncoveredShare = r.lines?.total
            ? 1 - r.lines.covered / r.lines.total
            : r.lines
              ? 0
              : 1;
        r.risk = Math.round(r.churn * uncoveredShare * 100) / 100;
    }
}

function addStatus(recs) {
    for (const r of recs) {
        if (r.status === 'unmeasured') continue;
        if (r.lines.total === 0) r.status = 'no-code';
        else if (r.lines.covered === 0)
            r.status = r.e2e ? 'e2e-only' : 'untested';
        else if (r.lines.covered === r.lines.total) r.status = 'covered';
        else r.status = 'partial';
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const o = {
        paths: [],
        only: false,
        all: false,
        risk: false,
        json: false,
        unitOnly: false,
        days: 90,
        limit: 20,
        base: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--only') o.only = true;
        else if (a === '--all') o.all = true;
        else if (a === '--risk') o.risk = true;
        else if (a === '--json') o.json = true;
        else if (a === '--unit-only') o.unitOnly = true;
        else if (a === '--days') o.days = Number(argv[++i]);
        else if (a === '--limit') o.limit = Number(argv[++i]);
        else if (a === '--base') o.base = argv[++i];
        else if (a.startsWith('--')) {
            console.error(
                `Unknown flag ${a}. See scripts/coverage/touched.mjs.`
            );
            process.exit(2);
        } else o.paths.push(a);
    }
    if (!(o.days > 0) || !(o.limit > 0)) {
        console.error('--days and --limit take a positive number.');
        process.exit(2);
    }
    o.base ??= defaultBaseRef();
    return o;
}

function readCache(tier) {
    try {
        return JSON.parse(
            readFileSync(join(cacheDir, `${tier.slug}.json`), 'utf8')
        );
    } catch {
        return { files: {} };
    }
}

function writeCache(tier, cache) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${tier.slug}.json`), JSON.stringify(cache));
}

/** The tier's map from the last `pnpm coverage`, stamped with its mtime. */
function readFull(tier) {
    const file = join(outDir, tier.slug, 'coverage-final.json');
    try {
        const at = statSync(file).mtimeMs;
        const map = loadMap(file);
        const out = {};
        for (const abs of map.files()) {
            if (abs.startsWith(root + '/'))
                out[abs.slice(root.length + 1)] = {
                    at,
                    data: map.fileCoverageFor(abs).toJSON(),
                };
        }
        return { at, files: out };
    } catch {
        return { at: null, files: {} };
    }
}

function metric({ covered, total }) {
    return {
        covered,
        total,
        pct: total ? Math.round((covered / total) * 1000) / 10 : null,
    };
}

function pct(m) {
    return (m.pct === null ? '—' : `${m.pct.toFixed(1)}%`).padStart(6);
}

/**
 * Uncovered line ranges. Only lines holding a statement count, so a range
 * runs across blank/comment lines until a covered statement interrupts it.
 */
function uncoveredRanges(cov) {
    const lineHits = Object.entries(cov.getLineCoverage())
        .map(([line, hits]) => [Number(line), hits])
        .sort((a, b) => a[0] - b[0]);
    const ranges = [];
    let open = null;
    for (const [line, hits] of lineHits) {
        if (hits === 0) {
            if (open) open[1] = line;
            else open = [line, line];
        } else if (open) {
            ranges.push(open);
            open = null;
        }
    }
    if (open) ranges.push(open);
    return ranges;
}

function formatRanges(ranges) {
    const text = ranges
        .slice(0, 5)
        .map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`));
    if (ranges.length > 5) text.push(`+${ranges.length - 5} more`);
    return text.join(',');
}

function byWorst(recs) {
    const STATUS_RANK = {
        unmeasured: 0,
        untested: 1,
        'e2e-only': 2,
        partial: 3,
        covered: 4,
        'no-code': 5,
    };
    const uncoveredLines = (r) =>
        r.lines ? r.lines.total - r.lines.covered : 0;
    return [...recs].sort(
        (a, b) =>
            STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
            (a.lines?.pct ?? 0) - (b.lines?.pct ?? 0) ||
            uncoveredLines(b) - uncoveredLines(a) ||
            a.path.localeCompare(b.path)
    );
}

function byRisk(recs) {
    return [...recs].sort(
        (a, b) => b.risk - a.risk || a.path.localeCompare(b.path)
    );
}

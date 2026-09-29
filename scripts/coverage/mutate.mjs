#!/usr/bin/env node
/**
 * `pnpm mutate` — would any test notice if the code I changed broke? (#494)
 *
 *   pnpm mutate                  source files changed vs main (merge base)
 *   pnpm mutate lib/upload/*.ts  …plus these files, dirs or globs
 *   pnpm mutate --only <paths>   exactly these instead
 *   pnpm mutate --all            every source file (slow: opt-in)
 *   --unit-only     skip the integration tiers (no Postgres)
 *   --db-from-env   use DATABASE_URL as is (CI's service container) instead
 *                   of a throwaway Postgres
 *   --rerun         ignore cached results
 *   --base <ref>    compare against <ref> instead of origin/main
 *   --json          machine-readable output (schema in docs/conventions/testing.md)
 *   --markdown      a Markdown summary (CI's job summary)
 *
 * Stryker mutates the files (flips `>` to `>=`, empties a block, drops one
 * term of a query's `and(…)` or its whole `.where(…)`…) and runs the tests
 * that cover each mutant. A mutant no test fails on "survives": a concrete
 * change the tests don't notice. How and why it runs the way it does:
 * scripts/coverage/mutation.mjs.
 */
import { relative } from 'node:path';
import { NAME as DRIZZLE_CONDITION } from './drizzle-condition.mjs';
import { defaultBaseRef, repoFiles, resolveFileSet } from './files.mjs';
import { reportHtml, runMutation } from './mutation.mjs';
import { color, isSource, root } from './shared.mjs';

const SURVIVORS_SHOWN = 12;

const opts = parseArgs(process.argv.slice(2));
const c = color(
    !opts.json && !opts.markdown && (process.stdout.isTTY ?? false)
);
const allFiles = repoFiles();
const fileSet = resolveFileSet(opts, allFiles);
const files = fileSet.files.filter(isSource).sort();
const unmatched = fileSet.unmatched.map((arg) => `⚠ no such file: ${arg}`);

if (files.length === 0) {
    const text =
        opts.all || opts.only
            ? 'No source files in the given paths.'
            : `No source files changed vs ${opts.base} (${fileSet.base.slice(0, 7)}). Name files to mutate, or use --all.`;
    if (opts.json) console.log(JSON.stringify(jsonOutput(null), null, 2));
    else console.log([...unmatched, text].join('\n'));
    process.exit(0);
}

const progress =
    !opts.json && !opts.markdown && process.stderr.isTTY
        ? (text) => process.stderr.write(`\r\x1b[2K${c.dim(text)}`)
        : undefined;
const run = await runMutation(files, {
    unitOnly: opts.unitOnly,
    dbFromEnv: opts.dbFromEnv,
    rerun: opts.rerun,
    allFiles,
    onProgress: progress,
});
if (progress) process.stderr.write('\r\x1b[2K');
const notices = [...unmatched, ...run.notices];

if (opts.json) console.log(JSON.stringify(jsonOutput(run), null, 2));
else if (opts.markdown) console.log(markdown(run));
else printText(run);

process.exit(run.failure ? 1 : 0);

// ───────────────────────────────────────────────────────────────────────

function records(run) {
    return files
        .map((path) => ({
            path,
            ...(run.results.get(path) ?? { unmeasured: true }),
        }))
        .sort(
            (a, b) =>
                rank(a) - rank(b) ||
                (a.score ?? 0) - (b.score ?? 0) ||
                b.total - b.killed - (a.total - a.killed) ||
                a.path.localeCompare(b.path)
        );
}

// Unmeasured (its run failed) first, then no tests, then by score.
function rank(r) {
    if (r.unmeasured) return 0;
    if (!r.tested) return 1;
    return r.total === 0 ? 3 : 2;
}

function totals(recs) {
    const measured = recs.filter((r) => r.tested);
    const sum = (key) => measured.reduce((n, r) => n + r[key], 0);
    const killed = sum('killed');
    const total = sum('total');
    const reached = total - sum('noCoverage');
    const byMutator = {};
    for (const r of measured)
        for (const [name, counts] of Object.entries(r.byMutator)) {
            byMutator[name] ??= { killed: 0, survived: 0, noCoverage: 0 };
            for (const [key, n] of Object.entries(counts))
                byMutator[name][key] += n;
        }
    return {
        killed,
        total,
        score: percent(killed, total),
        // Of the mutants some test runs: how good the tests that exist are.
        coveredScore: percent(killed, reached),
        byMutator,
    };
}

/** "12 DrizzleCondition (10 killed)": the one mutator that is ours. */
function ownMutantsText(t) {
    const own = t.byMutator[DRIZZLE_CONDITION];
    if (!own) return '';
    const count = own.killed + own.survived + own.noCoverage;
    return `${count} ${DRIZZLE_CONDITION} (${own.killed} killed)`;
}

function percent(part, whole) {
    return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

function scopeLabel() {
    if (opts.all) return 'all source files';
    if (opts.only) return 'named files';
    return `changed vs ${opts.base} ${fileSet.base.slice(0, 7)}`;
}

function printText(run) {
    for (const n of notices) console.log(c.yellow(n));
    if (run.failure) console.log(`${c.red('✗ not measured:')} ${run.failure}`);
    const recs = records(run);
    for (const r of recs) {
        if (r.unmeasured) {
            console.log(`     —         —  ${r.path}`);
            continue;
        }
        if (!r.tested) {
            console.log(
                `     —         —  ${r.path}  ${c.red('no test imports it')}`
            );
            continue;
        }
        const score = r.score === null ? '—' : `${r.score.toFixed(1)}%`;
        const counts = `${r.killed}/${r.total}`;
        console.log(`${score.padStart(6)}  ${counts.padStart(8)}  ${r.path}`);
        for (const s of r.survivors.slice(0, SURVIVORS_SHOWN))
            console.log(`        ${survivorLine(s)}`);
        if (r.survivors.length > SURVIVORS_SHOWN)
            console.log(
                c.dim(
                    `        +${r.survivors.length - SURVIVORS_SHOWN} more survivors (--json, or the HTML report)`
                )
            );
        if (r.noCoverage)
            console.log(
                c.dim(
                    `        no test runs ${formatRanges(r.noCoverageLines)} (${r.noCoverage === 1 ? '1 mutant' : `${r.noCoverage} mutants`})`
                )
            );
    }
    const t = totals(recs);
    const scoreText =
        t.score === null
            ? ''
            : `, ${t.killed} killed (${t.score}%; ${t.coveredScore ?? 0}% of those a test runs)`;
    const own = ownMutantsText(t);
    const ownText = own ? ` · ${own}` : '';
    const cached = files.length - run.ran.length;
    const cachedText = cached ? ` · ${cached} cached` : '';
    console.log(
        c.dim(
            `${files.length === 1 ? '1 file' : `${files.length} files`} · ${t.total} mutants${scoreText}${ownText} · ${scopeLabel()}${cachedText} · ${run.seconds.toFixed(1)}s`
        )
    );
    if (recs.some((r) => r.survived > 0))
        console.log(
            c.dim(
                'survivor: a change no test noticed. Kill it with an assertion on that behaviour, or mark it equivalent. See "Mutation testing" in docs/conventions/testing.md.'
            )
        );
    // The HTML report holds the files Stryker mutated this time only.
    if (run.ran.length > 0 && !run.failure)
        console.log(c.dim(`report: ${relative(root, reportHtml)}`));
}

function survivorLine(s) {
    const where = `L${s.line}`.padEnd(6);
    const change = `${c.red(s.original || '∅')} → ${c.green(replacement(s))}`;
    const by = coveredBy(s);
    return `${where}${change}  ${c.dim(`${mutatorLabel(s)}; ${by}`)}`;
}

// A DrizzleCondition mutant's `undefined` is how drizzle drops a condition.
function replacement(s) {
    return s.description ? '∅' : s.replacement || '∅';
}

function mutatorLabel(s) {
    return s.description ? `${s.mutator}, ${s.description}` : s.mutator;
}

function coveredBy(s) {
    if (s.coveredBy.length === 0)
        return s.static ? 'runs at import, every related test ran' : 'no test';
    const files = [...new Set(s.coveredBy.map((t) => t.split(' › ')[0]))];
    const count =
        s.coveredBy.length === 1 ? '1 test' : `${s.coveredBy.length} tests`;
    return `${count} ran it: ${files.slice(0, 2).join(', ')}${files.length > 2 ? `, +${files.length - 2}` : ''}`;
}

function formatRanges(ranges) {
    const text = ranges
        .slice(0, 5)
        .map(([a, b]) => (a === b ? `L${a}` : `L${a}-${b}`));
    if (ranges.length > 5) text.push(`+${ranges.length - 5} more`);
    return text.join(',');
}

function markdown(run) {
    const recs = records(run);
    const t = totals(recs);
    const out = [
        `### Mutation testing: ${t.score === null ? 'no mutants' : `${t.score}% of ${t.total} mutants killed`}`,
        '',
        `${[scopeLabel(), run.tiers.map((x) => x.name).join(', '), ownMutantsText(t)].filter(Boolean).join(' · ')} · ${run.seconds.toFixed(0)}s. A survivor is a change no test noticed; see "Mutation testing" in \`docs/conventions/testing.md\`. Not a merge gate.`,
        '',
    ];
    for (const n of notices) out.push(`> ${n}`, '');
    if (run.failure) out.push('```', `not measured: ${run.failure}`, '```', '');
    out.push(
        '| Score | Killed | Survived | No test runs | File |',
        '| --: | --: | --: | --: | --- |'
    );
    for (const r of recs) {
        if (r.unmeasured || !r.tested) {
            out.push(
                `| — | — | — | — | \`${r.path}\` ${r.unmeasured ? '(not measured)' : '(no test imports it)'} |`
            );
            continue;
        }
        out.push(
            `| ${r.score === null ? '—' : `${r.score}%`} | ${r.killed} | ${r.survived} | ${r.noCoverage} | \`${r.path}\` |`
        );
    }
    for (const r of recs.filter((x) => x.survived > 0)) {
        out.push(
            '',
            `<details><summary>${r.survived} ${r.survived === 1 ? 'survivor' : 'survivors'} in <code>${r.path}</code></summary>`,
            ''
        );
        for (const s of r.survivors)
            out.push(
                `- L${s.line} \`${s.original.replaceAll('`', "'")}\` → \`${replacement(s).replaceAll('`', "'")}\` (${mutatorLabel(s)}; ${coveredBy(s)})`
            );
        out.push('', '</details>');
    }
    return out.join('\n');
}

function jsonOutput(run) {
    const recs = run ? records(run) : [];
    return {
        version: 1,
        mode: opts.all ? 'all' : opts.only ? 'only' : 'changed',
        base: fileSet.base,
        seconds: run?.seconds ?? 0,
        tiers: run ? run.tiers.map((t) => t.name) : [],
        mutated: run?.ran ?? [],
        notices: run ? notices : unmatched,
        failure: run?.failure ?? null,
        ...(run
            ? totals(recs)
            : {
                  killed: 0,
                  total: 0,
                  score: null,
                  coveredScore: null,
                  byMutator: {},
              }),
        files: recs.map(({ unmeasured, ...r }) =>
            unmeasured ? { path: r.path, status: 'unmeasured' } : r
        ),
    };
}

function parseArgs(argv) {
    const o = {
        paths: [],
        only: false,
        all: false,
        json: false,
        markdown: false,
        unitOnly: false,
        dbFromEnv: false,
        rerun: false,
        base: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--only') o.only = true;
        else if (a === '--all') o.all = true;
        else if (a === '--json') o.json = true;
        else if (a === '--markdown') o.markdown = true;
        else if (a === '--unit-only') o.unitOnly = true;
        else if (a === '--db-from-env') o.dbFromEnv = true;
        else if (a === '--rerun') o.rerun = true;
        else if (a === '--base') o.base = argv[++i];
        else if (a.startsWith('--')) {
            console.error(
                `Unknown flag ${a}. See scripts/coverage/mutate.mjs.`
            );
            process.exit(2);
        } else o.paths.push(a);
    }
    o.base ??= defaultBaseRef();
    return o;
}

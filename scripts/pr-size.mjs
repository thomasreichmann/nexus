#!/usr/bin/env node
/**
 * GitHub's PR +/- headline counts every changed line, so a PR carrying drizzle
 * snapshots or a lockfile bump reads far larger than the surface a reviewer
 * actually has to read (#440: +1124 headline, ~350 lines of logic). The
 * headline can't be corrected, so this prints the honest breakdown instead —
 * logic vs. tests vs. generated — and pr-check.yml publishes it as a sticky
 * comment. A hand-written "actual size" note in the PR body would drift; this
 * file is the single reviewed definition of what counts as what.
 *
 *   pnpm pr:size                     current branch vs origin/main, including
 *                                    uncommitted and untracked work
 *   pnpm pr:size <base> <head>       that range instead
 *   ... --markdown                   emit the PR comment body (what CI runs);
 *                                    silent on a pure-logic diff, where the
 *                                    headline already is the logic count
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Committed but never reviewed. Kept in sync with `.prettierignore`, which
// excludes exactly these two from formatting for the same reason.
const GENERATED = [
    /^packages\/db\/src\/migrations\/meta\//,
    /^pnpm-lock\.yaml$/,
];

// Test *infrastructure* counts as tests, not logic — fixtures, seed factories
// and the per-package `testing.ts` doubles are written to be read as tests,
// and lumping them into logic is what made #440's number misleading.
const TESTS = [
    /^apps\/web\/e2e\//,
    /\.(test|spec)\.[cm]?[jt]sx?$/,
    /(^|\/)test-db\//,
    /(^|\/)(testing|test-utils|fixtures|mocks)\.[cm]?[jt]sx?$/,
    /(^|\/)(vitest|playwright)\.(config|setup)\./,
];

function classify(path) {
    if (GENERATED.some((re) => re.test(path))) return 'generated';
    if (TESTS.some((re) => re.test(path))) return 'tests';
    return 'logic';
}

function run(command, options = {}) {
    return execSync(command, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        ...options,
    });
}

/**
 * `--numstat -z` emits `adds\tdels\tpath\0` per file, except for renames and
 * copies, where the path field is empty and the old and new paths follow as
 * two more NUL-separated fields. Parsing the NUL form avoids the ambiguous
 * `{a => b}` arrow syntax that plain --numstat uses.
 */
function parseNumstat(raw) {
    const fields = raw.split('\0');
    const files = [];

    for (let i = 0; i < fields.length; i++) {
        if (!fields[i]) continue;
        const [adds, dels, path] = fields[i].split('\t');
        if (path === '') {
            // Rename or copy: the next two fields are the old and new paths.
            files.push({ path: fields[i + 2], adds, dels });
            i += 2;
        } else {
            files.push({ path, adds, dels });
        }
    }

    // Binary files report `-` for both counts; they contribute no lines.
    return files.map((f) => ({
        path: f.path,
        adds: f.adds === '-' ? 0 : Number(f.adds),
        dels: f.dels === '-' ? 0 : Number(f.dels),
    }));
}

function readRangeDiff(base, head) {
    return parseNumstat(run(`git diff --numstat -z ${base}...${head}`));
}

/**
 * Uncommitted edits and brand-new files are part of "what I have changed", but
 * a plain `git diff` sees neither. Staging everything into a throwaway index —
 * never the real one, so `git status` is untouched — makes them visible through
 * the same numstat path, so renames, binaries and .gitignore all behave exactly
 * as they will once the work is committed.
 */
function readWorkingDiff(base) {
    const root = run('git rev-parse --show-toplevel').trim();
    const dir = mkdtempSync(join(tmpdir(), 'pr-size-'));
    const options = {
        cwd: root,
        env: { ...process.env, GIT_INDEX_FILE: join(dir, 'index') },
    };

    try {
        run('git read-tree HEAD', options);
        run('git add -A', options);
        return parseNumstat(
            run(`git diff --numstat -z --cached ${base}`, options)
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function tally(files) {
    const empty = () => ({ files: 0, adds: 0, dels: 0 });
    const buckets = { logic: empty(), tests: empty(), generated: empty() };

    for (const file of files) {
        const bucket = buckets[classify(file.path)];
        bucket.files += 1;
        bucket.adds += file.adds;
        bucket.dels += file.dels;
    }

    return buckets;
}

function totalsOf(buckets, names) {
    return names.reduce(
        (sum, name) => ({
            files: sum.files + buckets[name].files,
            adds: sum.adds + buckets[name].adds,
            dels: sum.dels + buckets[name].dels,
        }),
        { files: 0, adds: 0, dels: 0 }
    );
}

function renderRow(label, bucket) {
    return `| ${label} | ${bucket.files} | +${bucket.adds} | −${bucket.dels} |`;
}

function render(buckets) {
    const reviewable = totalsOf(buckets, ['logic', 'tests']);
    const headline = totalsOf(buckets, ['logic', 'tests', 'generated']);

    // Only claim the headline overstates the work when something really is
    // excluded from it. With no generated files every line is reviewable, and
    // a "Reviewable" row would just restate the headline back at the reader —
    // there the useful signal is the logic/tests split alone.
    const hasGenerated = buckets.generated.files > 0;

    const intro = hasGenerated
        ? `Headline is **+${headline.adds} −${headline.dels}** across ${headline.files} files, but **+${buckets.generated.adds} −${buckets.generated.dels}** of that is generated. Actually reviewable: **+${reviewable.adds} −${reviewable.dels}**, of which **+${buckets.logic.adds} −${buckets.logic.dels}** is logic.`
        : `Headline is **+${headline.adds} −${headline.dels}** across ${headline.files} files, none of it generated. **+${buckets.logic.adds} −${buckets.logic.dels}** of that is logic, the rest tests.`;

    const rows = [
        renderRow('Logic', buckets.logic),
        renderRow('Tests', buckets.tests),
    ];
    if (hasGenerated) {
        rows.push(renderRow('Generated', buckets.generated));
        rows.push(renderRow('**Reviewable**', reviewable));
    }

    return [
        '## Reviewable size',
        '',
        intro,
        '',
        '| Bucket | Files | Added | Removed |',
        '| --- | ---: | ---: | ---: |',
        ...rows,
        '',
        '<sub>Generated = drizzle migration snapshots and `pnpm-lock.yaml`. Tests includes e2e specs, fixtures and seed factories. What lands in which bucket is defined in <code>scripts/pr-size.mjs</code>.</sub>',
    ].join('\n');
}

const COLUMNS = [12, 6, 10, 10];

function renderTextRow(cells) {
    return cells
        .map((cell, i) =>
            i === 0 ? cell.padEnd(COLUMNS[i]) : cell.padStart(COLUMNS[i])
        )
        .join('');
}

function renderTextBucket(label, bucket) {
    return renderTextRow([
        label,
        String(bucket.files),
        `+${bucket.adds}`,
        `-${bucket.dels}`,
    ]);
}

function renderText(buckets, subject) {
    const total = totalsOf(buckets, ['logic', 'tests', 'generated']);
    const reviewable = totalsOf(buckets, ['logic', 'tests']);
    const rule = '-'.repeat(COLUMNS.reduce((a, b) => a + b, 0));

    return [
        '',
        `Reviewable size — ${subject}`,
        '',
        renderTextRow(['Bucket', 'Files', 'Added', 'Removed']),
        rule,
        renderTextBucket('Logic', buckets.logic),
        renderTextBucket('Tests', buckets.tests),
        renderTextBucket('Generated', buckets.generated),
        rule,
        renderTextBucket('Total', total),
        '',
        buckets.generated.files > 0
            ? `Reviewable (generated excluded): +${reviewable.adds} -${reviewable.dels}`
            : 'Nothing generated — every line here is reviewable.',
        '',
    ].join('\n');
}

const args = process.argv.slice(2);
const isMarkdown = args.includes('--markdown');
const [base, head] = args.filter((arg) => arg !== '--markdown');

// CI passes the PR's base and head SHAs. With none, report the branch as it
// stands right now — the question someone asks before opening the PR.
let files;
let subject;
if (base && head) {
    files = readRangeDiff(base, head);
    subject = `${base}...${head}`;
} else {
    files = readWorkingDiff(run('git merge-base origin/main HEAD').trim());
    const branch = run('git rev-parse --abbrev-ref HEAD').trim();
    subject = `${branch} vs origin/main, including uncommitted work`;
}

const buckets = tally(files);

if (isMarkdown) {
    // A pure-logic PR needs no comment: the headline is already the logic
    // count, and a table restating it is noise on a two-line fix. On the CLI
    // the reverse holds — you asked, so you get an answer either way.
    if (buckets.tests.files + buckets.generated.files > 0) {
        console.log(render(buckets));
    }
} else if (files.length === 0) {
    console.log(`\nNo changes — ${subject}.\n`);
} else {
    console.log(renderText(buckets, subject));
}

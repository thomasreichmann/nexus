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
 * Usage: node scripts/pr-size.mjs [base-ref] [head-ref]   (pnpm pr:size)
 *
 * Prints the comment body to stdout, or nothing for a pure-logic PR — there
 * the headline already is the logic count and a breakdown adds nothing.
 */
import { execSync } from 'node:child_process';

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

/**
 * `--numstat -z` emits `adds\tdels\tpath\0` per file, except for renames and
 * copies, where the path field is empty and the old and new paths follow as
 * two more NUL-separated fields. Parsing the NUL form avoids the ambiguous
 * `{a => b}` arrow syntax that plain --numstat uses.
 */
function readDiff(base, head) {
    const raw = execSync(`git diff --numstat -z ${base}...${head}`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });

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

function renderRow(label, bucket) {
    return `| ${label} | ${bucket.files} | +${bucket.adds} | −${bucket.dels} |`;
}

function render(buckets) {
    const reviewable = {
        files: buckets.logic.files + buckets.tests.files,
        adds: buckets.logic.adds + buckets.tests.adds,
        dels: buckets.logic.dels + buckets.tests.dels,
    };
    const headline = {
        files: reviewable.files + buckets.generated.files,
        adds: reviewable.adds + buckets.generated.adds,
        dels: reviewable.dels + buckets.generated.dels,
    };

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

// CI passes the PR's base and head SHAs; the defaults are for running it by
// hand on a branch (`pnpm pr:size`).
const [base = 'origin/main', head = 'HEAD'] = process.argv.slice(2);

const buckets = tally(readDiff(base, head));

// A pure-logic PR needs no breakdown: the headline is the logic count, and a
// table restating it is pure noise on a two-line fix.
const hasNonLogic = buckets.tests.files + buckets.generated.files > 0;
if (hasNonLogic) {
    console.log(render(buckets));
}

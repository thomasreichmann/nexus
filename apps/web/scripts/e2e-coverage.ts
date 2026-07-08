/**
 * E2E coverage report — cross-references Playwright test tags against the
 * coverage manifest (e2e/coverage/manifest.ts) and writes
 * coverage/e2e-coverage.json for the /dev/coverage dashboard.
 *
 * Usage:
 *   pnpm -F web e2e:coverage           # generate report + print summary
 *   pnpm -F web e2e:coverage --check   # also exit 1 if below 100%
 *
 * Tests declare coverage via tags: `@page:<route>` and `@uc:<use-case-id>`.
 * Listing tests does not start the dev server or any browser.
 */
import { execFileSync } from 'node:child_process';
import {
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PAGES, USE_CASES } from '../e2e/coverage/manifest';

/**
 * Tests under e2e/validate/ and e2e/repro/ never run in CI or `pnpm check`.
 * Validate is the manual tier — it only counts as coverage when the
 * manifest entry acknowledges it with a `manual` reason. Repro specs are
 * untagged by convention (they graduate out of repro/ before earning tags),
 * so treating them as manual means a prematurely-tagged repro spec trips
 * the unacknowledged-manual gate instead of silently counting as automated
 * coverage.
 */
const isManualTier = (file: string) =>
    file.includes('validate/') || file.includes('repro/');

interface ListedTest {
    file: string;
    title: string;
    tags: string[];
}

interface SuiteNode {
    title: string;
    specs?: { title: string; tags?: string[]; file: string }[];
    suites?: SuiteNode[];
}

function listTests(): ListedTest[] {
    const outFile = join(tmpdir(), `pw-list-${process.pid}.json`);
    try {
        execFileSync(
            'npx',
            ['playwright', 'test', '--list', '--reporter=json'],
            {
                cwd: join(__dirname, '..'),
                env: {
                    ...process.env,
                    PLAYWRIGHT_JSON_OUTPUT_NAME: outFile,
                    // The validate/repro projects are env-gated out of
                    // normal runs; include them here so manual-tier
                    // coverage is reported and repro tags get typo-checked.
                    E2E_VALIDATE: '1',
                    E2E_REPRO: '1',
                },
                stdio: 'ignore',
            }
        );
        const report = JSON.parse(readFileSync(outFile, 'utf8')) as {
            suites: SuiteNode[];
        };
        const tests = new Map<string, ListedTest>();
        const walk = (node: SuiteNode) => {
            for (const spec of node.specs ?? []) {
                // Specs repeat per project; dedupe on file + title.
                tests.set(`${spec.file}::${spec.title}`, {
                    file: spec.file,
                    title: spec.title,
                    tags: (spec.tags ?? []).map((t) => t.replace(/^@/, '')),
                });
            }
            for (const child of node.suites ?? []) walk(child);
        };
        for (const suite of report.suites) walk(suite);
        return [...tests.values()];
    } finally {
        rmSync(outFile, { force: true });
    }
}

function testsWithTag(tests: ListedTest[], tag: string) {
    return tests
        .filter((t) => t.tags.includes(tag))
        .map(({ file, title }) => ({ file, title }));
}

/**
 * Routes derived from the app router (`app/<segments>/page.tsx`, route
 * groups stripped). The manifest is cross-checked against this so a page
 * shipped without a manifest entry fails `--check` instead of leaving the
 * gate at a hollow 100%.
 */
function appRoutes(appDir: string): string[] {
    const routes: string[] = [];
    const walk = (dir: string, segments: string[]) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                // Private folders and API routes never render pages.
                if (entry.name.startsWith('_') || entry.name === 'api') {
                    continue;
                }
                const isGroup =
                    entry.name.startsWith('(') && entry.name.endsWith(')');
                walk(
                    join(dir, entry.name),
                    isGroup ? segments : [...segments, entry.name]
                );
            } else if (entry.name === 'page.tsx') {
                routes.push('/' + segments.join('/'));
            }
        }
    };
    walk(appDir, []);
    return routes.sort();
}

function main() {
    const tests = listTests();

    const pages = PAGES.map((p) => {
        const covering = testsWithTag(tests, `page:${p.route}`);
        return {
            ...p,
            covered: covering.length > 0,
            automated: covering.some((t) => !isManualTier(t.file)),
            tests: covering,
        };
    });

    const useCases = USE_CASES.map((uc) => {
        const covering = testsWithTag(tests, `uc:${uc.id}`);
        return {
            ...uc,
            covered: covering.length > 0,
            automated: covering.some((t) => !isManualTier(t.file)),
            tests: covering,
        };
    });

    // Manifest ↔ filesystem cross-check: a page on disk that isn't listed
    // would otherwise be invisible to the 100% target.
    const routesOnDisk = appRoutes(join(__dirname, '..', 'app'));
    const manifestRoutes = new Set(PAGES.map((p) => p.route));
    const unlistedPages = routesOnDisk.filter((r) => !manifestRoutes.has(r));
    const staleManifestPages = PAGES.map((p) => p.route).filter(
        (r) => !routesOnDisk.includes(r)
    );

    // Validate-only coverage must be acknowledged in the manifest.
    const unacknowledgedManual = useCases.filter(
        (uc) => uc.covered && !uc.automated && !uc.manual && !uc.excluded
    );

    // Tags that don't match any manifest entry are almost always typos —
    // surface them instead of silently counting nothing.
    const knownTags = new Set([
        ...PAGES.map((p) => `page:${p.route}`),
        ...USE_CASES.map((uc) => `uc:${uc.id}`),
    ]);
    const unknownTags = [
        ...new Set(
            tests
                .flatMap((t) => t.tags)
                .filter(
                    (tag) =>
                        (tag.startsWith('page:') || tag.startsWith('uc:')) &&
                        !knownTags.has(tag)
                )
        ),
    ];

    const inScope = useCases.filter((uc) => !uc.excluded);
    const excluded = useCases.filter((uc) => uc.excluded);
    const coveredPages = pages.filter((p) => p.covered);
    const coveredUseCases = inScope.filter((uc) => uc.covered);
    const manualOnlyUseCases = inScope.filter(
        (uc) => uc.covered && !uc.automated
    );

    const pct = (covered: number, total: number) =>
        total > 0 ? (covered / total) * 100 : 100;

    const report = {
        generatedAt: new Date().toISOString(),
        pages: {
            total: pages.length,
            covered: coveredPages.length,
            pct: pct(coveredPages.length, pages.length),
            items: pages,
        },
        useCases: {
            total: inScope.length,
            covered: coveredUseCases.length,
            manualOnly: manualOnlyUseCases.length,
            excluded: excluded.length,
            pct: pct(coveredUseCases.length, inScope.length),
            items: useCases,
        },
        unknownTags,
        unlistedPages,
        testCount: tests.length,
    };

    const outDir = join(__dirname, '..', 'coverage');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
        join(outDir, 'e2e-coverage.json'),
        JSON.stringify(report, null, 2)
    );

    const fmt = (n: number) => `${n.toFixed(1)}%`;
    console.log(`E2E coverage (${tests.length} tests)`);
    console.log(
        `  Pages:     ${coveredPages.length}/${pages.length} (${fmt(report.pages.pct)})`
    );
    console.log(
        `  Use-cases: ${coveredUseCases.length}/${inScope.length} (${fmt(report.useCases.pct)})` +
            (excluded.length > 0 ? ` — ${excluded.length} excluded` : '')
    );
    if (manualOnlyUseCases.length > 0) {
        console.log(
            `\n  Manual tier only (validate — not run in CI/pnpm check):`
        );
        for (const uc of manualOnlyUseCases) console.log(`    - ${uc.id}`);
    }

    const uncoveredPages = pages.filter((p) => !p.covered);
    const uncoveredUseCases = inScope.filter((uc) => !uc.covered);
    if (uncoveredPages.length > 0) {
        console.log('\n  Uncovered pages:');
        for (const p of uncoveredPages) console.log(`    - ${p.route}`);
    }
    if (uncoveredUseCases.length > 0) {
        console.log('\n  Uncovered use-cases:');
        for (const uc of uncoveredUseCases)
            console.log(`    - ${uc.id} (${uc.area})`);
    }
    if (unknownTags.length > 0) {
        console.log('\n  Tags not in manifest (typo?):');
        for (const tag of unknownTags) console.log(`    - @${tag}`);
    }
    if (unlistedPages.length > 0) {
        console.log('\n  Pages on disk missing from the manifest:');
        for (const r of unlistedPages) console.log(`    - ${r}`);
    }
    if (staleManifestPages.length > 0) {
        console.log('\n  Manifest pages with no app route (stale entry?):');
        for (const r of staleManifestPages) console.log(`    - ${r}`);
    }
    if (unacknowledgedManual.length > 0) {
        console.log(
            '\n  Covered only by the manual validate tier without a `manual` reason in the manifest:'
        );
        for (const uc of unacknowledgedManual) console.log(`    - ${uc.id}`);
    }

    console.log(`\n  Report: coverage/e2e-coverage.json`);

    if (
        process.argv.includes('--check') &&
        (uncoveredPages.length > 0 ||
            uncoveredUseCases.length > 0 ||
            unknownTags.length > 0 ||
            unlistedPages.length > 0 ||
            staleManifestPages.length > 0 ||
            unacknowledgedManual.length > 0)
    ) {
        process.exit(1);
    }
}

main();

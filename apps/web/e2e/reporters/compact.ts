/**
 * Compact Playwright reporter — the e2e counterpart of scripts/check.mjs.
 *
 * The default terminal reporters print a progress line per test (~1 line/test
 * plus ANSI rewrites), which floods terminals and LLM context windows. This
 * reporter prints nothing while running, one summary line on success, and on
 * failure only the actionable part of each error plus a pointer to the
 * error-context snapshot (read it on demand instead of dumping it).
 *
 * Full output when needed: `npx playwright test --reporter=list` (the CLI
 * flag overrides this config) or `npx playwright show-report` for traces.
 */
import type {
    FullConfig,
    FullResult,
    Reporter,
    Suite,
    TestCase,
} from '@playwright/test/reporter';
import { relative } from 'node:path';

const MAX_ERROR_LINES = 20;

export default class CompactReporter implements Reporter {
    private suite!: Suite;
    private rootDir = process.cwd();
    private isTTY = process.stdout.isTTY ?? false;

    printsToStdio() {
        // Tells Playwright a terminal reporter exists, so it doesn't append
        // its own (which would reintroduce the per-test progress noise).
        return true;
    }

    onBegin(config: FullConfig, suite: Suite) {
        this.suite = suite;
        this.rootDir = config.rootDir;
    }

    onEnd(result: FullResult) {
        const tests = this.suite.allTests();
        const byOutcome = (o: ReturnType<TestCase['outcome']>) =>
            tests.filter((t) => t.outcome() === o);

        const failed = byOutcome('unexpected');
        const flaky = byOutcome('flaky');
        const skipped = byOutcome('skipped');
        const passed = byOutcome('expected').length;

        const c = this.color();
        const secs = `${(result.duration / 1000).toFixed(1)}s`;

        for (const test of failed) this.printFailure(test);

        // Flaky = passed only on retry. Named even on green runs so
        // flakiness is visible instead of laundered by retries.
        for (const test of flaky) {
            console.log(
                `${c.yellow('⚠ flaky')} ${this.label(test)} ${c.dim('(passed on retry)')}`
            );
        }

        const counts = [`${passed}/${tests.length} passed`];
        if (failed.length > 0) counts.push(`${failed.length} failed`);
        if (flaky.length > 0) counts.push(`${flaky.length} flaky`);
        if (skipped.length > 0) counts.push(`${skipped.length} did not run`);

        if (result.status === 'passed') {
            console.log(
                [
                    c.green('✓'),
                    c.bold('e2e passed'),
                    c.dim(counts.join('  ')),
                    c.dim(secs),
                ].join('  ')
            );
        } else {
            console.log(
                [
                    c.red('✗'),
                    c.bold(`e2e ${result.status}`),
                    c.dim(counts.join('  ')),
                    c.dim(secs),
                ].join('  ')
            );
            console.log(
                c.dim(
                    '  full output: --reporter=list · traces: npx playwright show-report'
                )
            );
        }
    }

    private printFailure(test: TestCase) {
        const c = this.color();
        const result = test.results.at(-1);
        console.log(`${c.red('✗')} ${this.label(test)}`);

        const message = result?.errors[0]?.message;
        if (message) {
            const lines = stripAnsi(message).split('\n');
            const shown = lines.slice(0, MAX_ERROR_LINES);
            for (const line of shown) console.log(`    ${line}`);
            if (lines.length > shown.length) {
                console.log(
                    c.dim(`    … +${lines.length - shown.length} more lines`)
                );
            }
        }

        // Page snapshot at the moment of failure — a pointer, not a dump.
        const context = result?.attachments.find(
            (a) => a.name === 'error-context'
        );
        if (context?.path) {
            // cwd-relative so the path is directly readable/cat-able.
            console.log(
                c.dim(`    context: ${relative(process.cwd(), context.path)}`)
            );
        }
        console.log('');
    }

    private label(test: TestCase) {
        const project = test.parent.project()?.name ?? '';
        const file = relative(this.rootDir, test.location.file);
        return `[${project}] ${file}:${test.location.line} › ${test.title}`;
    }

    private color() {
        const wrap = (code: string) => (s: string) =>
            this.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
        return {
            green: wrap('32'),
            red: wrap('31'),
            yellow: wrap('33'),
            dim: wrap('2'),
            bold: wrap('1'),
        };
    }
}

function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

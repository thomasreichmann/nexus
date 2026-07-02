/**
 * Compact Playwright reporter — the e2e counterpart of scripts/check.mjs.
 *
 * The default terminal reporters print a progress line per test (~1 line/test
 * plus ANSI rewrites), which floods terminals and LLM context windows. This
 * reporter prints nothing while running, one summary line on success, and on
 * failure the actionable part of each error, the slice of webServer output for
 * that test (the server-side cause Playwright otherwise hides — see
 * webserver-log.ts), and the inlined error-context page snapshot.
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
    TestResult,
} from '@playwright/test/reporter';
import {
    closeSync,
    existsSync,
    openSync,
    readFileSync,
    readSync,
    statSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import { WEBSERVER_LOG } from '../helpers/webserver-log';

const MAX_ERROR_LINES = 20;
// Server-log slice shown under a failing test: prefer warn/error lines, else
// fall back to the tail so there's always some context.
const MAX_SERVER_LINES = 25;
const SERVER_TAIL_LINES = 12;
// Inlined page snapshot (error-context.md) — a pointer alone is useless in CI,
// which uploads no artifacts.
const MAX_SNAPSHOT_LINES = 20;

const PINO_LEVELS: Record<number, string> = {
    60: 'FATAL',
    50: 'ERROR',
    40: 'WARN',
    30: 'INFO',
    20: 'DEBUG',
    10: 'TRACE',
};

export default class CompactReporter implements Reporter {
    private suite!: Suite;
    private rootDir = process.cwd();
    private isTTY = process.stdout.isTTY ?? false;
    private serverLog = resolve(process.cwd(), WEBSERVER_LOG);
    // Byte range of the webServer log written during each test. Clean under
    // `workers: 1` (CI); interleaves across tests under parallel local runs.
    private logRanges = new Map<TestResult, { start: number; end: number }>();

    printsToStdio() {
        // Tells Playwright a terminal reporter exists, so it doesn't append
        // its own (which would reintroduce the per-test progress noise).
        return true;
    }

    onBegin(config: FullConfig, suite: Suite) {
        this.suite = suite;
        this.rootDir = config.rootDir;
    }

    onTestBegin(_test: TestCase, result: TestResult) {
        const at = this.logSize();
        this.logRanges.set(result, { start: at, end: at });
    }

    onTestEnd(_test: TestCase, result: TestResult) {
        const range = this.logRanges.get(result);
        if (range) range.end = this.logSize();
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

        // Server-side cause: the slice of webServer output written while this
        // test ran. Playwright hides this stream from us (see webserver-log.ts),
        // so without it a failure like a thrown API handler is invisible in CI.
        if (result) this.printServerLog(result, c);

        // Page snapshot at the moment of failure. Inlined (not just pointed to)
        // because CI uploads no artifacts, so the path is unreadable after the
        // run — and the visible error text often names the client-side cause.
        const context = result?.attachments.find(
            (a) => a.name === 'error-context'
        );
        if (context?.path && existsSync(context.path)) {
            console.log(c.dim('    ── page snapshot ──'));
            const snapshot = safeRead(context.path);
            const lines = snapshot.split('\n');
            for (const line of lines.slice(0, MAX_SNAPSHOT_LINES)) {
                console.log(`    ${line}`);
            }
            if (lines.length > MAX_SNAPSHOT_LINES) {
                console.log(
                    c.dim(
                        `    … +${lines.length - MAX_SNAPSHOT_LINES} more lines`
                    )
                );
            }
            // cwd-relative so the full snapshot is directly readable/cat-able.
            console.log(
                c.dim(`    context: ${relative(process.cwd(), context.path)}`)
            );
        }
        console.log('');
    }

    private printServerLog(
        result: TestResult,
        c: ReturnType<CompactReporter['color']>
    ) {
        const range = this.logRanges.get(result);
        if (!range || range.end <= range.start) return;
        const raw = this.readLogSlice(range.start, range.end);
        if (!raw.trim()) return;

        const entries = parseServerLines(raw);
        // Prefer warn+ lines (the actionable ones); fall back to the tail so a
        // failure with only info-level logs still shows recent server activity.
        const errors = entries.filter((e) => e.level >= 40);
        const chosen = errors.length
            ? errors
            : entries.slice(-SERVER_TAIL_LINES);
        if (!chosen.length) return;

        console.log(c.dim('    ── server log (this test) ──'));
        for (const entry of chosen.slice(0, MAX_SERVER_LINES)) {
            const paint =
                entry.level >= 50
                    ? c.red
                    : entry.level >= 40
                      ? c.yellow
                      : c.dim;
            console.log(`    ${paint(entry.text)}`);
        }
        if (chosen.length > MAX_SERVER_LINES) {
            console.log(
                c.dim(`    … +${chosen.length - MAX_SERVER_LINES} more lines`)
            );
        }
    }

    private logSize(): number {
        try {
            return existsSync(this.serverLog)
                ? statSync(this.serverLog).size
                : 0;
        } catch {
            return 0;
        }
    }

    private readLogSlice(start: number, end: number): string {
        const size = end - start;
        if (size <= 0) return '';
        let fd: number | undefined;
        try {
            fd = openSync(this.serverLog, 'r');
            const buf = Buffer.alloc(size);
            const read = readSync(fd, buf, 0, size, start);
            return buf.toString('utf8', 0, read);
        } catch {
            return '';
        } finally {
            if (fd !== undefined) closeSync(fd);
        }
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

interface ServerLine {
    level: number;
    text: string;
}

/**
 * Turn raw webServer output into displayable lines. The e2e server runs a
 * production build, so pino emits single-line JSON — parse it into
 * `LEVEL msg — err` and keep the numeric level for filtering/coloring. Lines
 * that aren't pino JSON (raw stack traces, uncaught exceptions on stderr) are
 * surfaced at warn level rather than hidden.
 */
function parseServerLines(raw: string): ServerLine[] {
    return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
            try {
                const obj = JSON.parse(line);
                if (obj && typeof obj.level === 'number') {
                    const name = PINO_LEVELS[obj.level] ?? `L${obj.level}`;
                    let text = `${name} ${obj.msg ?? ''}`.trimEnd();
                    if (obj.err) text += ` — ${formatErr(obj.err)}`;
                    return { level: obj.level, text };
                }
            } catch {
                // not JSON — fall through
            }
            return { level: 40, text: line };
        });
}

function formatErr(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
        const e = err as {
            type?: string;
            name?: string;
            message?: string;
        };
        const type = e.type ?? e.name ?? 'Error';
        return e.message ? `${type}: ${e.message}` : type;
    }
    return String(err);
}

function safeRead(path: string): string {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return '';
    }
}

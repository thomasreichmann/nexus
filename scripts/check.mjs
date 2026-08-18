#!/usr/bin/env node
/**
 * `turbo run lint build test` dumps ~150 lines on a clean cached run.
 * This wrapper condenses passing runs to a single summary line so
 * `pnpm check` stays scannable in terminals and LLM context windows.
 * On failure, noise is stripped to surface only actionable error output.
 * A repo-wide `prettier --check` runs alongside turbo — formatting drift
 * fails the gate here instead of surfacing later in review.
 * Pass --verbose for the full prettier + turbo output.
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const turboExtra = args.filter((a) => a !== '--verbose');
const turboArgs = ['run', 'lint', 'build', 'test', ...turboExtra];
const prettierArgs = ['--check', '.'];

if (verbose) {
    // Sequential so the two inherited stdio streams don't interleave.
    const prettier = await run('prettier', prettierArgs);
    const turbo = await run('turbo', turboArgs);
    process.exit(prettier.code !== 0 || turbo.code !== 0 ? 1 : 0);
} else {
    turboArgs.push('--output-logs=errors-only');

    const isTTY = process.stdout.isTTY ?? false;
    const turboEnv = isTTY ? { ...process.env, FORCE_COLOR: '1' } : process.env;

    const [prettier, turbo] = await Promise.all([
        run('prettier', prettierArgs, { capture: true }),
        run('turbo', turboArgs, { capture: true, env: turboEnv }),
    ]);

    const plain = stripAnsi(turbo.output);

    const tasksMatch = plain.match(
        /Tasks:\s+(\d+)\s+successful(?:,\s+(\d+)\s+failed)?,\s+(\d+)\s+total/
    );
    const cachedMatch = plain.match(
        /Cached:\s+(\d+)\s+cached,\s+(\d+)\s+total/
    );
    const timeMatch = plain.match(/Time:\s+([\d.]+(?:ms|s))/);

    const passed = tasksMatch?.[1] ?? '?';
    const total = tasksMatch?.[3] ?? '?';
    const cachedN = cachedMatch?.[1] ?? '0';
    const elapsed = timeMatch?.[1] ?? '';

    const c = color(isTTY);

    if (prettier.code === 0 && turbo.code === 0) {
        const parts = [c.green('✓'), c.bold('All checks passed')];
        parts.push(c.dim(`${passed}/${total} tasks`));
        if (cachedN !== '0') parts.push(c.dim(`${cachedN} cached`));
        if (elapsed) parts.push(c.dim(elapsed));
        console.log(parts.join('  '));
        process.exit(0);
    }

    if (turbo.code !== 0) process.stdout.write(filterFailureOutput(plain));
    if (prettier.code !== 0)
        process.stdout.write(formatPrettierFailure(prettier.output));

    const parts = [c.red('✗'), c.bold('Checks failed')];
    if (passed !== '?' && total !== '?')
        parts.push(c.dim(`${passed}/${total} tasks passed`));
    if (elapsed) parts.push(c.dim(elapsed));
    console.log(parts.join('  '));
    process.exit(1);
}

/**
 * Spawn a command; with `capture` its output is buffered for filtering,
 * otherwise stdio is inherited.
 */
function run(cmd, cmdArgs, { capture = false, env = process.env } = {}) {
    return new Promise((resolve) => {
        const proc = spawn(cmd, cmdArgs, {
            env,
            stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
        });
        /** @type {Buffer[]} */
        const chunks = [];
        if (capture) {
            proc.stdout.on('data', (d) => chunks.push(d));
            proc.stderr.on('data', (d) => chunks.push(d));
        }
        proc.on('error', (err) => bail(cmd, err));
        proc.on('close', (code) =>
            resolve({
                code: code ?? 1,
                output: Buffer.concat(chunks).toString(),
            })
        );
    });
}

function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Reduce `prettier --check` failure output to the unformatted file list.
 */
function formatPrettierFailure(output) {
    const files = stripAnsi(output)
        .split('\n')
        .filter((l) => l.startsWith('[warn] '))
        .map((l) => l.slice('[warn] '.length).trim())
        .filter((f) => f !== '' && !f.startsWith('Code style issues'));
    return [
        'prettier FAILED — run `pnpm exec prettier --write` on:',
        ...files.map((f) => `  ${f}`),
        '',
        '',
    ].join('\n');
}

/**
 * Filter turbo error output down to actionable lines only.
 * Strips task prefixes first, then filters noise (turbo metadata,
 * passing tests, pnpm lifecycle, vitest profiling, duplicate errors).
 */
function filterFailureOutput(plain) {
    const lines = plain.split('\n');
    // Turbo prefixes: @nexus/web:test: (logs), @nexus/web#test (summaries), trpc-devtools:build: (unscoped)
    const taskPrefixRe = /^(@?[\w@/-]+[:#]\w+):?\s*/;
    const shownTasks = new Set();
    const kept = [];
    let prevBlank = false;

    for (const rawLine of lines) {
        let content = rawLine;
        let task = null;
        const prefixMatch = rawLine.trim().match(taskPrefixRe);
        if (prefixMatch) {
            task = prefixMatch[1];
            content = rawLine.trim().slice(prefixMatch[0].length);
        }

        const trimmed = content.trim();

        // Collapse consecutive blank lines to max 1
        if (trimmed === '') {
            if (!prevBlank && kept.length > 0) kept.push('');
            prevBlank = true;
            continue;
        }
        prevBlank = false;

        if (isNoise(trimmed)) continue;

        if (task && !shownTasks.has(task)) {
            shownTasks.add(task);
            kept.push(`${task} FAILED`);
        }

        kept.push(content);
    }

    // Trim leading/trailing blank lines
    while (kept.length > 0 && kept[0].trim() === '') kept.shift();
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

    return kept.length > 0 ? kept.join('\n') + '\n\n' : '';
}

function isNoise(trimmed) {
    // Turbo metadata
    if (trimmed.startsWith('•')) return true;
    // Turbo summary lines (we print our own)
    if (/^(Tasks|Cached|Time|Failed):/.test(trimmed)) return true;
    // Turbo error boilerplate (narrow match to avoid swallowing real errors)
    if (/^ERROR\s+run\s+failed/.test(trimmed)) return true;
    if (/ELIFECYCLE/.test(trimmed)) return true;
    if (/command.*exited\s+\(\d+\)/.test(trimmed)) return true;
    // pnpm script invocation lines ("> vitest", "> next build", etc.)
    if (trimmed.startsWith('>')) return true;
    // Cache status
    if (/^cache (miss|hit),/.test(trimmed)) return true;
    // Vitest RUN header
    if (/^RUN\s+v[\d.]+/.test(trimmed)) return true;
    // Vitest timing/profiling
    if (/^Start at\s/.test(trimmed)) return true;
    if (/^Duration\s/.test(trimmed)) return true;
    // Passing test lines (file-level and individual)
    if (/^✓\s/.test(trimmed)) return true;
    // Decorative separators (vitest ⎯ lines)
    if (trimmed.includes('⎯⎯⎯⎯')) return true;

    return false;
}

function bail(cmd, err) {
    console.error(`Failed to run ${cmd}: ${err.message}`);
    process.exit(1);
}

function color(enabled) {
    const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
    return {
        green: wrap('32'),
        red: wrap('31'),
        dim: wrap('2'),
        bold: wrap('1'),
    };
}

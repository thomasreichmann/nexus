#!/usr/bin/env node
/**
 * `turbo run lint build test` dumps ~150 lines on a clean cached run.
 * This wrapper condenses passing runs to a single summary line so
 * `pnpm check` stays scannable in terminals and LLM context windows.
 * On failure, noise is stripped to surface only actionable error output.
 * Pass --verbose for the full turbo output.
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const turboExtra = args.filter((a) => a !== '--verbose');
const turboArgs = ['run', 'lint', 'build', 'test', ...turboExtra];

if (verbose) {
    const proc = spawn('turbo', turboArgs, { stdio: 'inherit' });
    proc.on('error', bail);
    proc.on('close', (code) => process.exit(code ?? 1));
} else {
    turboArgs.push('--output-logs=errors-only');

    const isTTY = process.stdout.isTTY ?? false;
    const proc = spawn('turbo', turboArgs, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: isTTY ? { ...process.env, FORCE_COLOR: '1' } : process.env,
    });

    /** @type {Buffer[]} */
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => chunks.push(d));
    proc.on('error', bail);

    proc.on('close', (code) => {
        const raw = Buffer.concat(chunks).toString();
        const plain = stripAnsi(raw);

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

        if (code === 0) {
            const parts = [c.green('✓'), c.bold('All checks passed')];
            parts.push(c.dim(`${passed}/${total} tasks`));
            if (cachedN !== '0') parts.push(c.dim(`${cachedN} cached`));
            if (elapsed) parts.push(c.dim(elapsed));
            console.log(parts.join('  '));
        } else {
            const filtered = filterFailureOutput(plain);
            process.stdout.write(filtered);

            const parts = [c.red('✗'), c.bold('Checks failed')];
            if (passed !== '?' && total !== '?')
                parts.push(c.dim(`${passed}/${total} tasks passed`));
            if (elapsed) parts.push(c.dim(elapsed));
            console.log(parts.join('  '));
        }

        process.exit(code ?? 1);
    });
}

function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
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

function bail(err) {
    console.error(`Failed to run turbo: ${err.message}`);
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

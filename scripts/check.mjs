#!/usr/bin/env node
/**
 * `turbo run lint build test` dumps ~150 lines on a clean cached run.
 * This wrapper condenses passing runs to a single summary line so
 * `pnpm check` stays scannable in terminals and LLM context windows.
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

    /** @type {{ stream: 'out' | 'err', data: Buffer }[]} */
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push({ stream: 'out', data: d }));
    proc.stderr.on('data', (d) => chunks.push({ stream: 'err', data: d }));
    proc.on('error', bail);

    proc.on('close', (code) => {
        const raw = chunks.map((c) => c.data.toString()).join('');
        const plain = raw.replace(/\x1b\[[0-9;]*m/g, '');

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
            // Replay captured output (failing-task errors + turbo metadata)
            for (const chunk of chunks) {
                const target =
                    chunk.stream === 'err' ? process.stderr : process.stdout;
                target.write(chunk.data);
            }

            const parts = ['\n' + c.red('✗'), c.bold('Checks failed')];
            if (passed !== '?' && total !== '?')
                parts.push(c.dim(`${passed}/${total} tasks passed`));
            if (elapsed) parts.push(c.dim(elapsed));
            console.log(parts.join('  '));
        }

        process.exit(code ?? 1);
    });
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

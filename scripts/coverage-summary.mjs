import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const workspaces = [
    { name: '@nexus/web', dir: 'apps/web' },
    { name: '@nexus/worker', dir: 'apps/worker' },
    { name: '@nexus/db', dir: 'packages/db' },
    { name: 'trpc-devtools', dir: 'packages/trpc-devtools' },
];

function readSummary(dir) {
    const file = join(root, dir, 'coverage', 'coverage-summary.json');
    try {
        return JSON.parse(readFileSync(file, 'utf8')).total;
    } catch {
        return null;
    }
}

function fmt(pct) {
    return `${pct.toFixed(2)}%`.padStart(10);
}

const metrics = ['statements', 'branches', 'functions', 'lines'];
const header = ['Workspace', 'Stmts', 'Branch', 'Funcs', 'Lines'];
const colWidths = [18, 10, 10, 10, 10];

function printRow(cols) {
    console.log(cols.map((c, i) => c.padEnd(colWidths[i])).join(''));
}

function printSep() {
    console.log('-'.repeat(colWidths.reduce((a, b) => a + b, 0)));
}

const results = [];
let hasData = false;

for (const ws of workspaces) {
    const total = readSummary(ws.dir);
    if (total) {
        hasData = true;
        results.push({ ...ws, total });
    } else {
        results.push({ ...ws, total: null });
    }
}

if (!hasData) {
    console.log('\nNo coverage data found. Run `pnpm test:coverage` first.\n');
    process.exit(1);
}

console.log('\nCoverage Summary');
console.log('================\n');
printRow(header);
printSep();

const totals = { covered: [0, 0, 0, 0], total: [0, 0, 0, 0] };

for (const r of results) {
    if (!r.total) {
        printRow([r.name, ...metrics.map(() => '      n/a ')]);
        continue;
    }
    const pcts = metrics.map((m) => fmt(r.total[m].pct));
    printRow([r.name, ...pcts]);

    metrics.forEach((m, i) => {
        totals.covered[i] += r.total[m].covered;
        totals.total[i] += r.total[m].total;
    });
}

printSep();

const totalPcts = metrics.map((_, i) =>
    totals.total[i] > 0
        ? fmt((totals.covered[i] / totals.total[i]) * 100)
        : '      n/a '
);
printRow(['Total', ...totalPcts]);

console.log('');

// --open flag: open HTML reports in browser
if (process.argv.includes('--open')) {
    const openCmd =
        platform() === 'darwin'
            ? 'open'
            : platform() === 'win32'
              ? 'start'
              : 'xdg-open';

    for (const ws of workspaces) {
        const htmlIndex = join(root, ws.dir, 'coverage', 'index.html');
        try {
            execSync(`${openCmd} "${htmlIndex}"`, { stdio: 'ignore' });
            console.log(`Opened: ${ws.dir}/coverage/index.html`);
        } catch {
            console.log(`Skipped: ${ws.dir}/coverage/index.html (not found)`);
        }
    }
    console.log('');
}

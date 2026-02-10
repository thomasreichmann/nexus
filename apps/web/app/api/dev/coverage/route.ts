import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKSPACES = [
    { name: '@nexus/web', dir: 'apps/web' },
    { name: '@nexus/worker', dir: 'apps/worker' },
    { name: '@nexus/db', dir: 'packages/db' },
    { name: 'trpc-devtools', dir: 'packages/trpc-devtools' },
] as const;

const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;

interface MetricData {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
}

function findRoot(): string {
    const cwd = process.cwd();
    return existsSync(join(cwd, 'pnpm-workspace.yaml'))
        ? cwd
        : join(cwd, '../..');
}

export async function GET(): Promise<NextResponse> {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const root = findRoot();
    const workspaces: Record<string, unknown>[] = [];
    const agg: Record<string, { covered: number; total: number }> = {};

    for (const m of METRICS) {
        agg[m] = { covered: 0, total: 0 };
    }

    for (const ws of WORKSPACES) {
        const file = join(root, ws.dir, 'coverage', 'coverage-summary.json');
        try {
            const summary = JSON.parse(readFileSync(file, 'utf8'))
                .total as Record<string, MetricData>;
            const entry: Record<string, unknown> = { name: ws.name };
            for (const m of METRICS) {
                entry[m] = summary[m];
                agg[m].covered += summary[m].covered;
                agg[m].total += summary[m].total;
            }
            workspaces.push(entry);
        } catch {
            workspaces.push({ name: ws.name, error: true });
        }
    }

    const total: Record<string, unknown> = {};
    for (const m of METRICS) {
        total[m] = {
            ...agg[m],
            pct:
                agg[m].total > 0
                    ? (agg[m].covered / agg[m].total) * 100
                    : 0,
        };
    }

    return NextResponse.json({ workspaces, total });
}

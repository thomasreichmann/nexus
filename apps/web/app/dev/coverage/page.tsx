'use client';

import { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MetricData {
    total: number;
    covered: number;
    pct: number;
}

interface WorkspaceData {
    name: string;
    statements?: MetricData;
    branches?: MetricData;
    functions?: MetricData;
    lines?: MetricData;
    error?: boolean;
}

interface CoverageResponse {
    workspaces: WorkspaceData[];
    total: Record<string, MetricData>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;
type MetricKey = (typeof METRICS)[number];

const LABELS: Record<MetricKey, string> = {
    statements: 'Statements',
    branches: 'Branches',
    functions: 'Functions',
    lines: 'Lines',
};

/* ------------------------------------------------------------------ */
/*  Colors                                                             */
/* ------------------------------------------------------------------ */

function getColors(pct: number) {
    if (pct >= 85)
        return {
            fill: 'oklch(0.72 0.17 155)',
            track: 'oklch(0.72 0.17 155 / 0.15)',
        };
    if (pct >= 70)
        return {
            fill: 'oklch(0.62 0.19 260)',
            track: 'oklch(0.62 0.19 260 / 0.15)',
        };
    if (pct >= 50)
        return {
            fill: 'oklch(0.75 0.16 70)',
            track: 'oklch(0.75 0.16 70 / 0.15)',
        };
    return {
        fill: 'oklch(0.63 0.22 25)',
        track: 'oklch(0.63 0.22 25 / 0.15)',
    };
}

/* ------------------------------------------------------------------ */
/*  Animated counter hook                                              */
/* ------------------------------------------------------------------ */

function useCounter(
    target: number,
    ms: number,
    delay: number,
    go: boolean,
) {
    const [val, setVal] = useState(0);

    useEffect(() => {
        if (!go) {
            setVal(0);
            return;
        }
        let raf: number;
        const t0 = performance.now() + delay;
        function tick() {
            const p = Math.min(
                Math.max((performance.now() - t0) / ms, 0),
                1,
            );
            setVal(target * (1 - (1 - p) ** 3));
            if (p < 1) raf = requestAnimationFrame(tick);
        }
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, ms, delay, go]);

    return val;
}

/* ------------------------------------------------------------------ */
/*  Ring gauge                                                         */
/* ------------------------------------------------------------------ */

const R = 56;
const SW = 7;
const CIRC = 2 * Math.PI * R;
const VIEW = (R + SW) * 2;
const MID = VIEW / 2;

function RingGauge({
    pct,
    label,
    covered,
    total,
    ready,
    delay,
}: {
    pct: number;
    label: string;
    covered: number;
    total: number;
    ready: boolean;
    delay: number;
}) {
    const shown = useCounter(pct, 1200, delay, ready);
    const offset = ready ? CIRC * (1 - pct / 100) : CIRC;
    const { fill, track } = getColors(pct);

    return (
        <div className="flex flex-col items-center">
            <div className="relative">
                <svg
                    width={VIEW}
                    height={VIEW}
                    viewBox={`0 0 ${VIEW} ${VIEW}`}
                >
                    <circle
                        cx={MID}
                        cy={MID}
                        r={R}
                        fill="none"
                        stroke={track}
                        strokeWidth={SW}
                    />
                    <circle
                        cx={MID}
                        cy={MID}
                        r={R}
                        fill="none"
                        stroke={fill}
                        strokeWidth={SW}
                        strokeLinecap="round"
                        strokeDasharray={CIRC}
                        strokeDashoffset={offset}
                        transform={`rotate(-90 ${MID} ${MID})`}
                        style={{
                            transition: `stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
                        }}
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span
                        className="font-mono text-[22px] font-bold tabular-nums"
                        style={{ color: fill }}
                    >
                        {shown.toFixed(1)}
                        <span className="text-[14px] font-normal opacity-70">
                            %
                        </span>
                    </span>
                </div>
            </div>
            <p className="mt-3 text-sm font-medium">{label}</p>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                {covered.toLocaleString()}/{total.toLocaleString()}
            </p>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Progress bar                                                       */
/* ------------------------------------------------------------------ */

function MetricBar({
    label,
    pct,
    ready,
    delay,
}: {
    label: string;
    pct: number;
    ready: boolean;
    delay: number;
}) {
    const { fill, track } = getColors(pct);

    return (
        <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                    {label}
                </span>
                <span
                    className="font-mono text-xs font-medium tabular-nums"
                    style={{ color: fill }}
                >
                    {pct.toFixed(1)}%
                </span>
            </div>
            <div
                className="h-1.5 overflow-hidden rounded-full"
                style={{ backgroundColor: track }}
            >
                <div
                    className="h-full rounded-full"
                    style={{
                        width: ready ? `${pct}%` : '0%',
                        backgroundColor: fill,
                        transition: `width 0.8s cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
                    }}
                />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Workspace card                                                     */
/* ------------------------------------------------------------------ */

function WorkspaceCard({
    ws,
    ready,
    delay,
}: {
    ws: WorkspaceData;
    ready: boolean;
    delay: number;
}) {
    if (ws.error) {
        return (
            <div className="rounded-xl border border-border bg-card/50 px-5 py-4">
                <span className="font-mono text-sm font-medium">
                    {ws.name}
                </span>
                <span className="ml-3 text-xs text-muted-foreground">
                    no data
                </span>
            </div>
        );
    }

    return (
        <div
            className="rounded-xl border border-border bg-card/50 px-5 py-4 transition-colors hover:bg-card"
            style={{
                opacity: ready ? 1 : 0,
                transform: ready ? 'none' : 'translateY(8px)',
                transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms, background-color 0.15s`,
            }}
        >
            <p className="mb-3 font-mono text-sm font-medium">{ws.name}</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                {METRICS.map((m, i) => {
                    const d = ws[m];
                    if (!d) return null;
                    return (
                        <MetricBar
                            key={m}
                            label={LABELS[m]}
                            pct={d.pct}
                            ready={ready}
                            delay={delay + i * 60}
                        />
                    );
                })}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="flex min-h-screen flex-col bg-background"
            style={{
                backgroundImage:
                    'radial-gradient(circle, oklch(0.5 0 0 / 0.04) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
            }}
        >
            {children}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CoveragePage() {
    const [data, setData] = useState<CoverageResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        fetch('/api/dev/coverage')
            .then((r) => {
                if (!r.ok) throw new Error('Could not load coverage data');
                return r.json();
            })
            .then(setData)
            .catch((e: unknown) =>
                setError(
                    e instanceof Error ? e.message : 'Unknown error',
                ),
            );
    }, []);

    useEffect(() => {
        if (!data) return;
        const raf = requestAnimationFrame(() => setReady(true));
        return () => cancelAnimationFrame(raf);
    }, [data]);

    if (error) {
        return (
            <Shell>
                <div className="flex flex-1 items-center justify-center">
                    <p className="text-sm text-muted-foreground">{error}</p>
                </div>
            </Shell>
        );
    }

    if (!data) {
        return (
            <Shell>
                <div className="flex flex-1 items-center justify-center">
                    <p className="animate-pulse font-mono text-sm text-muted-foreground">
                        Loading coverage&hellip;
                    </p>
                </div>
            </Shell>
        );
    }

    const hasData = data.workspaces.some((ws) => !ws.error);
    if (!hasData) {
        return (
            <Shell>
                <div className="flex flex-1 items-center justify-center text-center">
                    <div>
                        <p className="font-medium">
                            No coverage data found
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Run{' '}
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                pnpm test:coverage
                            </code>{' '}
                            first.
                        </p>
                    </div>
                </div>
            </Shell>
        );
    }

    return (
        <Shell>
            <div className="mx-auto w-full max-w-5xl px-8 py-16">
                {/* Header */}
                <header className="mb-14">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                        Coverage
                    </p>
                    <h1 className="mt-1.5 text-3xl font-bold tracking-tight">
                        Test Coverage
                    </h1>
                </header>

                {/* Total gauges */}
                <section className="mb-14">
                    <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
                        {METRICS.map((m, i) => (
                            <RingGauge
                                key={m}
                                pct={data.total[m].pct}
                                label={LABELS[m]}
                                covered={data.total[m].covered}
                                total={data.total[m].total}
                                ready={ready}
                                delay={i * 120}
                            />
                        ))}
                    </div>
                </section>

                {/* Workspace breakdown */}
                <section>
                    <p className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                        Workspaces
                    </p>
                    <div className="space-y-3">
                        {data.workspaces.map((ws, i) => (
                            <WorkspaceCard
                                key={ws.name}
                                ws={ws}
                                ready={ready}
                                delay={300 + i * 80}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </Shell>
    );
}

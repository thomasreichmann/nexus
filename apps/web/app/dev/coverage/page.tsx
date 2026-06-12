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

interface CoveringTest {
    file: string;
    title: string;
}

interface E2ePageItem {
    route: string;
    title: string;
    auth: string;
    covered: boolean;
    tests: CoveringTest[];
}

interface E2eUseCaseItem {
    id: string;
    title: string;
    area: string;
    excluded?: string;
    covered: boolean;
    tests: CoveringTest[];
}

interface E2eReport {
    generatedAt: string;
    testCount: number;
    pages: {
        total: number;
        covered: number;
        pct: number;
        items: E2ePageItem[];
    };
    useCases: {
        total: number;
        covered: number;
        excluded: number;
        pct: number;
        items: E2eUseCaseItem[];
    };
    unknownTags: string[];
}

interface CoverageResponse {
    workspaces: WorkspaceData[];
    total: Record<string, MetricData>;
    e2e: E2eReport | null;
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

const AREA_LABELS: Record<string, string> = {
    auth: 'Auth',
    dashboard: 'Dashboard',
    files: 'Files',
    upload: 'Upload',
    billing: 'Billing',
    settings: 'Settings',
    'admin-jobs': 'Admin · Jobs',
    'admin-dev-tools': 'Admin · Dev tools',
    errors: 'Errors & feedback',
    navigation: 'Navigation',
    'dev-pages': 'Dev pages',
};

const R = 56;
const SW = 7;
const CIRC = 2 * Math.PI * R;
const VIEW = (R + SW) * 2;
const MID = VIEW / 2;

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
                setError(e instanceof Error ? e.message : 'Unknown error')
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

    return (
        <Shell>
            <div className="mx-auto w-full max-w-5xl px-8 py-10">
                <header className="mb-10">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                        Coverage
                    </p>
                    <h1 className="mt-1.5 text-3xl font-bold tracking-tight">
                        Test Coverage
                    </h1>
                </header>

                <E2ESection report={data.e2e} ready={ready} />
                <UnitSection data={data} ready={ready} />
            </div>
        </Shell>
    );
}

/* ------------------------------------------------------------------ */
/*  E2E section                                                        */
/* ------------------------------------------------------------------ */

function E2ESection({
    report,
    ready,
}: {
    report: E2eReport | null;
    ready: boolean;
}) {
    return (
        <section className="mb-14">
            <SectionHeading
                kicker="E2E · Playwright"
                hint={
                    report
                        ? `${report.testCount} tests · generated ${new Date(report.generatedAt).toLocaleString()}`
                        : undefined
                }
            />

            {!report ? (
                <EmptyHint command="pnpm -F web e2e:coverage" />
            ) : (
                <E2EBody report={report} ready={ready} />
            )}
        </section>
    );
}

function E2EBody({ report, ready }: { report: E2eReport; ready: boolean }) {
    const inScope = report.useCases.items.filter((uc) => !uc.excluded);
    const excluded = report.useCases.items.filter((uc) => uc.excluded);
    const gaps = [
        ...report.pages.items
            .filter((p) => !p.covered)
            .map((p) => ({ key: p.route, label: p.route, kind: 'page' })),
        ...inScope
            .filter((uc) => !uc.covered)
            .map((uc) => ({ key: uc.id, label: uc.id, kind: 'use-case' })),
    ];

    const areas = [...new Set(inScope.map((uc) => uc.area))];

    return (
        <>
            <div className="mb-8 grid grid-cols-2 gap-8 sm:grid-cols-4">
                <RingGauge
                    pct={report.pages.pct}
                    label="Pages"
                    covered={report.pages.covered}
                    total={report.pages.total}
                    ready={ready}
                    delay={0}
                />
                <RingGauge
                    pct={report.useCases.pct}
                    label="Use-cases"
                    covered={report.useCases.covered}
                    total={report.useCases.total}
                    ready={ready}
                    delay={120}
                />
                <div className="col-span-2 flex flex-col justify-center">
                    {gaps.length === 0 ? (
                        <AllCoveredBadge excluded={excluded.length} />
                    ) : (
                        <GapList gaps={gaps} />
                    )}
                </div>
            </div>

            {report.unknownTags.length > 0 && (
                <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-3">
                    <p className="font-mono text-xs text-red-600 dark:text-red-400">
                        Tags not in manifest:{' '}
                        {report.unknownTags.map((t) => `@${t}`).join(', ')}
                    </p>
                </div>
            )}

            <p className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                Pages
            </p>
            <div className="mb-8 grid gap-1.5 sm:grid-cols-2">
                {report.pages.items.map((p) => (
                    <ItemRow
                        key={p.route}
                        state={p.covered ? 'covered' : 'uncovered'}
                        title={p.title}
                        mono={p.route}
                        tests={p.tests}
                    />
                ))}
            </div>

            <p className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                Use-cases
            </p>
            <div className="space-y-3">
                {areas.map((area, i) => (
                    <AreaCard
                        key={area}
                        area={area}
                        items={inScope.filter((uc) => uc.area === area)}
                        ready={ready}
                        delay={200 + i * 60}
                    />
                ))}
            </div>

            {excluded.length > 0 && (
                <details className="group mt-6">
                    <summary className="cursor-pointer list-none font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:text-foreground">
                        <span className="mr-2 inline-block transition-transform group-open:rotate-90">
                            ▸
                        </span>
                        Excluded from target ({excluded.length})
                    </summary>
                    <div className="mt-3 grid gap-1.5">
                        {excluded.map((uc) => (
                            <ItemRow
                                key={uc.id}
                                state="excluded"
                                title={uc.title}
                                mono={uc.id}
                                reason={uc.excluded}
                            />
                        ))}
                    </div>
                </details>
            )}
        </>
    );
}

function AllCoveredBadge({ excluded }: { excluded: number }) {
    return (
        <div className="rounded-xl border border-[oklch(0.72_0.17_155_/_0.35)] bg-[oklch(0.72_0.17_155_/_0.07)] px-5 py-4">
            <p
                className="font-mono text-sm font-semibold"
                style={{ color: 'oklch(0.72 0.17 155)' }}
            >
                ● 100% — every page &amp; use-case covered
            </p>
            {excluded > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                    {excluded} use-case{excluded === 1 ? '' : 's'} deliberately
                    excluded (documented below)
                </p>
            )}
        </div>
    );
}

function GapList({
    gaps,
}: {
    gaps: { key: string; label: string; kind: string }[];
}) {
    return (
        <div className="rounded-xl border border-[oklch(0.63_0.22_25_/_0.35)] bg-[oklch(0.63_0.22_25_/_0.06)] px-5 py-4">
            <p
                className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'oklch(0.63 0.22 25)' }}
            >
                {gaps.length} gap{gaps.length === 1 ? '' : 's'} to 100%
            </p>
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {gaps.map((g) => (
                    <span
                        key={`${g.kind}:${g.key}`}
                        className="rounded-md bg-background/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                        {g.label}
                    </span>
                ))}
            </div>
        </div>
    );
}

function AreaCard({
    area,
    items,
    ready,
    delay,
}: {
    area: string;
    items: E2eUseCaseItem[];
    ready: boolean;
    delay: number;
}) {
    const covered = items.filter((i) => i.covered).length;
    const pct = items.length > 0 ? (covered / items.length) * 100 : 100;
    const { fill } = getColors(pct);

    return (
        <div
            className="rounded-xl border border-border bg-card/50 px-5 py-4 transition-colors hover:bg-card"
            style={{
                opacity: ready ? 1 : 0,
                transform: ready ? 'none' : 'translateY(8px)',
                transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms, background-color 0.15s`,
            }}
        >
            <div className="mb-3 flex items-baseline justify-between">
                <p className="font-mono text-sm font-medium">
                    {AREA_LABELS[area] ?? area}
                </p>
                <p
                    className="font-mono text-xs font-medium tabular-nums"
                    style={{ color: fill }}
                >
                    {covered}/{items.length}
                </p>
            </div>
            <div className="grid gap-1.5">
                {items.map((uc) => (
                    <ItemRow
                        key={uc.id}
                        state={uc.covered ? 'covered' : 'uncovered'}
                        title={uc.title}
                        mono={uc.id}
                        tests={uc.tests}
                    />
                ))}
            </div>
        </div>
    );
}

function ItemRow({
    state,
    title,
    mono,
    tests,
    reason,
}: {
    state: 'covered' | 'uncovered' | 'excluded';
    title: string;
    mono: string;
    tests?: CoveringTest[];
    reason?: string;
}) {
    const dot =
        state === 'covered'
            ? 'oklch(0.72 0.17 155)'
            : state === 'uncovered'
              ? 'oklch(0.63 0.22 25)'
              : 'oklch(0.5 0 0 / 0.4)';

    return (
        <div
            className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
            title={
                tests && tests.length > 0
                    ? tests.map((t) => `${t.file} › ${t.title}`).join('\n')
                    : undefined
            }
        >
            <span
                className="mt-1.5 size-1.5 shrink-0 rounded-full"
                style={{
                    backgroundColor: dot,
                    outline:
                        state === 'uncovered' ? `2px solid ${dot}33` : 'none',
                }}
            />
            <div className="min-w-0 flex-1">
                <p
                    className={
                        state === 'excluded'
                            ? 'text-sm text-muted-foreground'
                            : 'text-sm'
                    }
                >
                    {title}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground/70">
                    {mono}
                    {tests && tests.length > 0 && (
                        <span>
                            {' '}
                            · {tests.length} test{tests.length === 1 ? '' : 's'}
                        </span>
                    )}
                </p>
                {reason && (
                    <p className="mt-0.5 text-xs italic text-muted-foreground">
                        {reason}
                    </p>
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Unit section (Vitest)                                              */
/* ------------------------------------------------------------------ */

function UnitSection({
    data,
    ready,
}: {
    data: CoverageResponse;
    ready: boolean;
}) {
    const hasData = data.workspaces.some((ws) => !ws.error);

    return (
        <section>
            <SectionHeading kicker="Unit · Vitest" />

            {!hasData ? (
                <EmptyHint command="pnpm test:coverage" />
            ) : (
                <>
                    <div className="mb-10 grid grid-cols-2 gap-8 sm:grid-cols-4">
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
                </>
            )}
        </section>
    );
}

/* ------------------------------------------------------------------ */
/*  Shared chrome                                                      */
/* ------------------------------------------------------------------ */

function SectionHeading({ kicker, hint }: { kicker: string; hint?: string }) {
    return (
        <div className="mb-6 flex items-baseline justify-between border-b border-border pb-2">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                {kicker}
            </p>
            {hint && (
                <p className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
                    {hint}
                </p>
            )}
        </div>
    );
}

function EmptyHint({ command }: { command: string }) {
    return (
        <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
            <p className="text-sm font-medium">No data yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
                Run{' '}
                <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {command}
                </code>{' '}
                first.
            </p>
        </div>
    );
}

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

function useCounter(target: number, ms: number, delay: number, go: boolean) {
    const [val, setVal] = useState(0);

    useEffect(() => {
        if (!go) return;
        let raf: number;
        const t0 = performance.now() + delay;
        function tick() {
            const p = Math.min(Math.max((performance.now() - t0) / ms, 0), 1);
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
                <svg width={VIEW} height={VIEW} viewBox={`0 0 ${VIEW} ${VIEW}`}>
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
                <span className="font-mono text-sm font-medium">{ws.name}</span>
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

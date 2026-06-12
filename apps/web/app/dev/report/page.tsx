'use client';

import { useEffect, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Live coverage types (subset of /api/dev/coverage)                  */
/* ------------------------------------------------------------------ */

interface E2eReport {
    generatedAt: string;
    testCount: number;
    pages: { total: number; covered: number; pct: number };
    useCases: {
        total: number;
        covered: number;
        excluded: number;
        pct: number;
    };
    unknownTags: string[];
}

/* ------------------------------------------------------------------ */
/*  Session evidence — point-in-time record of the coverage work.     */
/*  Static by design: this page is the report artifact; the live      */
/*  numbers above it are re-fetched so the verdict stays honest.      */
/* ------------------------------------------------------------------ */

const REPORT_DATE = 'June 12, 2026';

const TIMELINE = [
    {
        phase: 'Baseline',
        title: 'Audit of the existing suite',
        detail: 'Ran the smoke tier as-is: 16/18 passing, one parallel-load flake, no coverage tracking of any kind. Swept all routes and tRPC routers to inventory what "everything" actually means: 13 pages, ~90 raw user interactions.',
    },
    {
        phase: 'Define',
        title: 'Coverage manifest as the contract',
        detail: 'Distilled the inventory into e2e/coverage/manifest.ts — 13 pages + 65 use-cases, 9 of them explicitly excluded with documented reasons (unconfigured OAuth, Stripe-hosted pages, server-to-server webhooks, placeholder settings forms). 100% is defined against this file, not vibes.',
    },
    {
        phase: 'Tooling',
        title: 'Tag-based report + CI gate',
        detail: 'Tests claim coverage via @page:/@uc: Playwright tags. `pnpm -F web e2e:coverage` cross-references tags against the manifest and writes coverage/e2e-coverage.json; `--check` exits non-zero below 100% or on tags that match nothing (typo guard).',
    },
    {
        phase: 'Retrofit',
        title: 'Tagged all 31 existing tests',
        detail: 'Existing smoke, admin, and validate specs annotated. Coverage at this point: 76.9% of pages, 37.5% of use-cases — the honest starting line.',
    },
    {
        phase: 'Surface',
        title: 'Dashboard on /dev/coverage',
        detail: 'Added the E2E section to the coverage dashboard: ring gauges, gaps panel, per-area cards with covering-test counts, exclusions with reasons. Unit (Vitest) coverage kept below it.',
    },
    {
        phase: 'Build',
        title: '33 new tests across 9 spec files',
        detail: 'Real auth flows (sign-up with trial provisioning, sign-in, sign-out), a new `flows` project where each spec creates a dedicated user — empty-state and exact-count assertions cannot race shared-user specs — covering the full file browser and upload queue, plus billing routing, admin dev-tools, jobs refresh, navigation/role visibility, and dev-page smoke tests.',
    },
    {
        phase: 'Stabilize',
        title: 'Fixed what the new rigor exposed',
        detail: 'Two pre-existing admin tests were already broken on main (stale pagination selectors; timeouts too tight for cold dev servers). Admin suite serialized (--workers=1) — its specs share the admin user’s data and raced across parallel workers.',
    },
    {
        phase: 'Dig',
        title: 'The validate flake that was a real bug',
        detail: 'The upload validation failed ~50% of runs: UI said "Uploaded", database said `uploading`. Ruled out the client, the service, the repo layer, and the transaction code by direct reproduction — then isolated it to prepared statements over Supabase’s transaction-mode pooler silently losing commits.',
    },
    {
        phase: 'Verify',
        title: 'Everything green, gate at 100%',
        detail: 'All four suites passing, validate 4/4 consecutive runs post-fix, pnpm check 10/10, e2e:coverage --check exits 0.',
    },
] as const;

const FINDINGS = [
    {
        kind: 'fixed' as const,
        severity: 'data loss',
        title: 'Lost transactions on the Supabase transaction pooler',
        where: 'packages/db/src/connection.ts',
        detail: 'createDb connected to the port-6543 transaction-mode pooler without `prepare: false`. Prepared statements can land on different pooled backends, so transactions intermittently returned success without committing — uploads stuck invisible at `uploading`, storage usage uncounted. One-line fix; validate tier went from ~50% flaky to 4/4 consecutive green runs.',
    },
    {
        kind: 'fixed' as const,
        severity: 'broken test',
        title: 'Admin jobs pagination spec was dead on main',
        where: 'e2e/admin/jobs.spec.ts',
        detail: 'Selectors targeted chevron-icon classes the pagination UI no longer renders ("Next page"/"Previous page" buttons now). The admin tier had not been run since that UI changed.',
    },
    {
        kind: 'fixed' as const,
        severity: 'flaky test',
        title: 'Cold-server timeouts on first S3 mutation',
        where: 'e2e/admin/files.spec.ts',
        detail: 'First S3-touching mutation on a cold dev server (route compile + SDK init) exceeded the 10s assertion window. Raised to 30s, matching the validate tier’s convention.',
    },
    {
        kind: 'flagged' as const,
        severity: 'product gap',
        title: 'Download always fails for standard-tier files',
        where: 'server/services/retrieval.ts',
        detail: 'getDownloadUrl requires a `ready` retrieval row, but freshly-uploaded standard-tier files show an enabled Download action — which can never succeed. Needs an issue: either gate the menu item or allow direct download for non-Glacier tiers.',
    },
    {
        kind: 'flagged' as const,
        severity: 'product gap',
        title: 'No auth guard on /dashboard routes',
        where: 'app/(dashboard)/layout.tsx',
        detail: 'Signed-out visitors get an empty dashboard shell (data is protected at the tRPC layer; only the admin layout redirects). The manifest encodes actual behavior; decide whether a redirect to /sign-in is wanted.',
    },
    {
        kind: 'flagged' as const,
        severity: 'placeholder',
        title: 'Settings profile / password / delete are no-ops',
        where: 'app/(dashboard)/dashboard/settings/page.tsx',
        detail: 'The forms render with hardcoded values and buttons with no handlers. Excluded from the coverage target with documented reasons rather than tested as if real.',
    },
] as const;

const SUITES = [
    {
        name: 'smoke',
        tests: 32,
        seconds: 22.9,
        note: 'public + authenticated render & flows',
    },
    {
        name: 'flows',
        tests: 17,
        seconds: 32.5,
        note: 'dedicated-user interactive flows',
    },
    {
        name: 'admin',
        tests: 15,
        seconds: 53.4,
        note: 'serialized — shared admin user',
    },
    {
        name: 'validate',
        tests: 6,
        seconds: 17.5,
        note: 'destructive dev-env validation',
    },
] as const;

const COUNTERS = [
    { label: 'E2E tests', before: '31', after: '64' },
    { label: 'Pages covered', before: '10/13', after: '13/13' },
    { label: 'Use-cases covered', before: '21/56', after: '56/56' },
    { label: 'Validate stability', before: '~50%', after: '4/4 runs' },
] as const;

const COMMANDS = [
    {
        cmd: 'pnpm -F web e2e:coverage --check',
        what: 'recompute coverage, exit 1 below 100%',
    },
    {
        cmd: 'pnpm -F web test:e2e:smoke',
        what: '32 tests · render + light flows',
    },
    {
        cmd: 'pnpm -F web test:e2e:flows',
        what: '17 tests · file browser + upload queue',
    },
    {
        cmd: 'pnpm -F web test:e2e:admin',
        what: '15 tests · jobs, dev-tools, deletion',
    },
    {
        cmd: 'pnpm -F web test:e2e:validate',
        what: '6 tests · real S3 upload + quota (destructive, dev env)',
    },
    {
        cmd: 'open /dev/coverage',
        what: 'live dashboard — gauges, gaps, exclusions',
    },
] as const;

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ReportPage() {
    const [e2e, setE2e] = useState<E2eReport | null | 'error'>(null);

    useEffect(() => {
        fetch('/api/dev/coverage')
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((d: { e2e: E2eReport | null }) => setE2e(d.e2e ?? 'error'))
            .catch(() => setE2e('error'));
    }, []);

    const verified =
        e2e !== null &&
        e2e !== 'error' &&
        e2e.pages.pct === 100 &&
        e2e.useCases.pct === 100 &&
        e2e.unknownTags.length === 0;

    return (
        <div
            className="min-h-screen bg-background text-foreground"
            style={{
                backgroundImage:
                    'radial-gradient(circle, oklch(0.5 0 0 / 0.04) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
            }}
        >
            <style>{`
                @keyframes report-rise {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: none; }
                }
                .report-rise { opacity: 0; animation: report-rise 0.55s cubic-bezier(0.22,1,0.36,1) forwards; }
                @keyframes stamp-in {
                    0% { opacity: 0; transform: rotate(-8deg) scale(1.6); }
                    100% { opacity: 1; transform: rotate(-6deg) scale(1); }
                }
                .report-stamp { opacity: 0; animation: stamp-in 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.5s forwards; }
            `}</style>

            <div className="mx-auto w-full max-w-3xl px-8 py-16">
                <TitleBlock verified={verified} e2e={e2e} />

                <SectionRule index="01" title="Coverage, live" delay={150} />
                <LiveCoverage e2e={e2e} />

                {/* Static session record — the live strip above is the
                    current truth; these counters are frozen at REPORT_DATE
                    and labeled as such so later drift can't read as a
                    contradiction. */}
                <SectionRule
                    index="02"
                    title={`Before / after · as of ${REPORT_DATE}`}
                    delay={250}
                />
                <div
                    className="report-rise mb-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4"
                    style={{ animationDelay: '300ms' }}
                >
                    {COUNTERS.map((c) => (
                        <div key={c.label} className="bg-card/80 px-4 py-4">
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                {c.label}
                            </p>
                            <p className="mt-2 font-mono text-sm tabular-nums text-muted-foreground/60 line-through decoration-[oklch(0.63_0.22_25_/_0.5)]">
                                {c.before}
                            </p>
                            <p
                                className="font-mono text-xl font-bold tabular-nums"
                                style={{ color: 'oklch(0.72 0.17 155)' }}
                            >
                                {c.after}
                            </p>
                        </div>
                    ))}
                </div>

                <SectionRule index="03" title="The path" delay={350} />
                <ol className="mb-16 space-y-0">
                    {TIMELINE.map((t, i) => (
                        <li
                            key={t.phase}
                            className="report-rise relative grid grid-cols-[88px_1fr] gap-5 pb-8 last:pb-0"
                            style={{ animationDelay: `${400 + i * 70}ms` }}
                        >
                            {/* rail */}
                            {i < TIMELINE.length - 1 && (
                                <span
                                    aria-hidden
                                    className="absolute left-[88px] top-5 bottom-0 ml-[-0.5px] w-px bg-border"
                                    style={{ transform: 'translateX(-22px)' }}
                                />
                            )}
                            <div className="text-right">
                                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                                    {t.phase}
                                </span>
                            </div>
                            <div className="relative">
                                <span
                                    aria-hidden
                                    className="absolute -left-[26px] top-[5px] size-2 rounded-full border border-border bg-background"
                                />
                                <h3 className="text-sm font-semibold leading-snug">
                                    {t.title}
                                </h3>
                                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                    {t.detail}
                                </p>
                            </div>
                        </li>
                    ))}
                </ol>

                <SectionRule index="04" title="Findings" delay={500} />
                <div className="mb-16 space-y-3">
                    {FINDINGS.map((f, i) => (
                        <article
                            key={f.title}
                            className="report-rise rounded-lg border border-border bg-card/60 p-5"
                            style={{ animationDelay: `${550 + i * 60}ms` }}
                        >
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span
                                    className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
                                    style={
                                        f.kind === 'fixed'
                                            ? {
                                                  color: 'oklch(0.72 0.17 155)',
                                                  backgroundColor:
                                                      'oklch(0.72 0.17 155 / 0.12)',
                                              }
                                            : {
                                                  color: 'oklch(0.75 0.16 70)',
                                                  backgroundColor:
                                                      'oklch(0.75 0.16 70 / 0.12)',
                                              }
                                    }
                                >
                                    {f.kind}
                                </span>
                                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                    {f.severity}
                                </span>
                                <span className="ml-auto hidden font-mono text-[10px] text-muted-foreground/60 sm:inline">
                                    {f.where}
                                </span>
                            </div>
                            <h3 className="text-sm font-semibold">{f.title}</h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                {f.detail}
                            </p>
                        </article>
                    ))}
                </div>

                <SectionRule index="05" title="Performance" delay={700} />
                <Performance />

                <SectionRule
                    index="06"
                    title="Validate it yourself"
                    delay={800}
                />
                <div
                    className="report-rise mb-16 overflow-hidden rounded-lg border border-border"
                    style={{ animationDelay: '850ms' }}
                >
                    {COMMANDS.map((c, i) => (
                        <div
                            key={c.cmd}
                            className={`flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-4 ${
                                i % 2 === 0 ? 'bg-card/60' : 'bg-card/30'
                            }`}
                        >
                            <code className="shrink-0 font-mono text-[13px] font-medium">
                                {c.cmd}
                            </code>
                            <span className="text-xs text-muted-foreground">
                                {c.what}
                            </span>
                        </div>
                    ))}
                </div>

                <footer
                    className="report-rise border-t border-border pt-6 pb-10"
                    style={{ animationDelay: '900ms' }}
                >
                    <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                        Prepared by Claude Code · {REPORT_DATE} · Sources:
                        e2e/coverage/manifest.ts, coverage/e2e-coverage.json,
                        suite run logs. Excluded use-cases are enumerated with
                        reasons on{' '}
                        <a
                            href="/dev/coverage"
                            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
                        >
                            /dev/coverage
                        </a>
                        .
                    </p>
                </footer>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Title block — engineering-drawing style                           */
/* ------------------------------------------------------------------ */

function TitleBlock({
    verified,
    e2e,
}: {
    verified: boolean;
    e2e: E2eReport | null | 'error';
}) {
    return (
        <header className="report-rise relative mb-16 rounded-xl border border-border bg-card/60 p-8">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                Engineering report · NX-E2E-001
            </p>
            <h1 className="mt-3 max-w-md text-3xl font-bold leading-tight tracking-tight">
                E2E Coverage: from untracked to a gated 100%
            </h1>

            <dl className="mt-6 grid max-w-md grid-cols-[110px_1fr] gap-y-1.5 font-mono text-[11px]">
                <dt className="uppercase tracking-wider text-muted-foreground">
                    Date
                </dt>
                <dd>{REPORT_DATE}</dd>
                <dt className="uppercase tracking-wider text-muted-foreground">
                    Author
                </dt>
                <dd>Claude Code (autonomous session)</dd>
                <dt className="uppercase tracking-wider text-muted-foreground">
                    Scope
                </dt>
                <dd>apps/web — all pages &amp; user-facing use-cases</dd>
                <dt className="uppercase tracking-wider text-muted-foreground">
                    Standard
                </dt>
                <dd>e2e/coverage/manifest.ts (65 use-cases, 9 excluded)</dd>
            </dl>

            {/* verdict stamp */}
            <div
                className="report-stamp absolute right-6 top-6 hidden rotate-[-6deg] rounded-md border-2 px-4 py-2 sm:block"
                style={{
                    borderColor: verified
                        ? 'oklch(0.72 0.17 155 / 0.7)'
                        : 'oklch(0.75 0.16 70 / 0.7)',
                    color: verified
                        ? 'oklch(0.72 0.17 155)'
                        : 'oklch(0.75 0.16 70)',
                }}
            >
                <p className="font-mono text-sm font-black uppercase tracking-[0.2em]">
                    {e2e === null
                        ? 'Checking…'
                        : verified
                          ? 'Verified'
                          : 'Re-check'}
                </p>
                <p className="font-mono text-[9px] uppercase tracking-widest opacity-80">
                    {e2e === null
                        ? 'live data'
                        : verified
                          ? '100% · live'
                          : 'see §01'}
                </p>
            </div>
        </header>
    );
}

/* ------------------------------------------------------------------ */
/*  Section rule                                                       */
/* ------------------------------------------------------------------ */

function SectionRule({
    index,
    title,
    delay,
}: {
    index: string;
    title: string;
    delay: number;
}) {
    return (
        <div
            className="report-rise mb-6 flex items-baseline gap-4 border-b border-border pb-2"
            style={{ animationDelay: `${delay}ms` }}
        >
            <span className="font-mono text-[11px] font-bold text-muted-foreground/50">
                §{index}
            </span>
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
                {title}
            </h2>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Live coverage strip                                                */
/* ------------------------------------------------------------------ */

function LiveCoverage({ e2e }: { e2e: E2eReport | null | 'error' }) {
    if (e2e === 'error') {
        return (
            <div className="report-rise mb-16 rounded-lg border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
                No coverage report found — run{' '}
                <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">
                    pnpm -F web e2e:coverage
                </code>{' '}
                and reload. The numbers below this section are the session
                record and remain valid as written.
            </div>
        );
    }

    const cell = (label: string, value: string, sub: string, ok: boolean) => (
        <div className="bg-card/80 px-5 py-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {label}
            </p>
            <p
                className="mt-1 font-mono text-3xl font-bold tabular-nums"
                style={{
                    color: ok ? 'oklch(0.72 0.17 155)' : 'oklch(0.63 0.22 25)',
                }}
            >
                {value}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {sub}
            </p>
        </div>
    );

    return (
        <div
            className="report-rise mb-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3"
            style={{ animationDelay: '200ms' }}
        >
            {e2e === null ? (
                <div className="col-span-full bg-card/80 px-5 py-6">
                    <p className="animate-pulse font-mono text-sm text-muted-foreground">
                        Fetching /api/dev/coverage…
                    </p>
                </div>
            ) : (
                <>
                    {cell(
                        'Pages',
                        `${e2e.pages.pct.toFixed(0)}%`,
                        `${e2e.pages.covered}/${e2e.pages.total} routes`,
                        e2e.pages.pct === 100
                    )}
                    {cell(
                        'Use-cases',
                        `${e2e.useCases.pct.toFixed(0)}%`,
                        `${e2e.useCases.covered}/${e2e.useCases.total} in scope · ${e2e.useCases.excluded} excluded`,
                        e2e.useCases.pct === 100
                    )}
                    {cell(
                        'Tagged tests',
                        String(e2e.testCount),
                        `report ${new Date(e2e.generatedAt).toLocaleString()}`,
                        true
                    )}
                </>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Performance section                                                */
/* ------------------------------------------------------------------ */

function Performance() {
    const max = Math.max(...SUITES.map((s) => s.seconds));
    const totalTests = SUITES.reduce((n, s) => n + s.tests, 0);
    const totalSeconds = SUITES.reduce((n, s) => n + s.seconds, 0);

    return (
        <div className="report-rise mb-16" style={{ animationDelay: '750ms' }}>
            <div className="overflow-hidden rounded-lg border border-border bg-card/60">
                {SUITES.map((s) => (
                    <div
                        key={s.name}
                        className="grid grid-cols-[84px_1fr_auto] items-center gap-4 border-b border-border/60 px-5 py-3.5 last:border-b-0"
                    >
                        <span className="font-mono text-xs font-semibold">
                            {s.name}
                        </span>
                        <div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[oklch(0.62_0.19_260_/_0.12)]">
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        width: `${(s.seconds / max) * 100}%`,
                                        backgroundColor: 'oklch(0.62 0.19 260)',
                                    }}
                                />
                            </div>
                            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                {s.note}
                            </p>
                        </div>
                        <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {s.tests} tests · {s.seconds.toFixed(1)}s
                        </span>
                    </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 px-1 font-mono text-[11px] text-muted-foreground">
                <span>
                    Σ {totalTests} test executions in {totalSeconds.toFixed(0)}s
                    wall-clock across tiers
                </span>
                <span>pnpm check (lint + build + unit): 18.1s, 10/10</span>
                <span>coverage report generation: ~3s, no browser</span>
            </div>
        </div>
    );
}

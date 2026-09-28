/**
 * Which source files the e2e (Playwright) tiers reach. Playwright produces no
 * line coverage, so a page exercised only by e2e would read as "untested";
 * `pnpm cov:touched` labels such files "e2e-only" instead.
 *
 * Heuristic, and deliberately generous: every page an automated spec tags
 * with `@page:<route>` (the e2e coverage manifest's signal), its layouts,
 * and everything they statically import, followed through the bridges a
 * browser crosses at runtime:
 * - `trpc.<router>.…` calls reach that router (and the /api/trpc handler);
 * - `/api/<path>` string literals, in reached code or in the specs, reach
 *   that route handler;
 * - the BetterAuth client reaches /api/auth.
 * It over-reports rather than under-reports: an e2e-only label means "some
 * spec probably renders this", never "this behavior is asserted".
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isSource, root } from './shared.mjs';

const WEB = 'apps/web';
// The appRouter aggregator imports every router. Following it would mark
// all of them reached; routers are reached per `trpc.<name>` call instead.
const STOP = new Set([`${WEB}/server/trpc/router.ts`]);

export function e2eReachedFiles() {
    const specs = walk(join(root, WEB, 'e2e'))
        .filter((f) => f.endsWith('.spec.ts'))
        // Manual/repro tiers never run in CI, so they don't count.
        .filter((f) => !/\/e2e\/(validate|repro)\//.test(f));
    const specText = specs.map((f) => readFileSync(join(root, f), 'utf8'));

    const routes = new Set(
        specText.flatMap((t) =>
            [...t.matchAll(/@page:(\/[^'"`\s]*)/g)].map((m) => m[1])
        )
    );
    const pages = appPages();
    const apiRoutes = appApiRoutes();
    const routers = trpcRouters();

    const reached = new Set();
    const queue = [
        `${WEB}/proxy.ts`,
        `${WEB}/instrumentation.ts`,
        ...[...routes].flatMap((r) => pages.get(r) ?? []),
        ...specText.flatMap((t) => apiRoutesIn(t, apiRoutes)),
    ];
    while (queue.length > 0) {
        const file = queue.pop();
        if (reached.has(file) || !existsSync(join(root, file))) continue;
        reached.add(file);
        if (STOP.has(file)) continue;
        const text = readFileSync(join(root, file), 'utf8');
        queue.push(...imports(text, file));
        queue.push(...apiRoutesIn(text, apiRoutes));
        for (const [, name] of text.matchAll(/\btrpc\.(\w+)\./g)) {
            if (routers.has(name))
                queue.push(routers.get(name), apiRoutes.get('/api/trpc'));
        }
        if (text.includes('createAuthClient'))
            queue.push(apiRoutes.get('/api/auth'));
    }
    return new Set([...reached].filter(isSource));
}

function walk(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
        return [relative(root, full)];
    });
}

/** route → [page file, layouts of every ancestor segment]. */
function appPages() {
    const pages = new Map();
    const visit = (dir, segments, layouts) => {
        const here = readdirSync(join(root, dir), { withFileTypes: true });
        const layout = here.find((e) => e.name === 'layout.tsx');
        const chain = layout ? [...layouts, `${dir}/layout.tsx`] : layouts;
        for (const e of here) {
            if (e.isDirectory()) {
                if (e.name.startsWith('_') || e.name === 'api') continue;
                const isGroup = e.name.startsWith('(') && e.name.endsWith(')');
                visit(
                    `${dir}/${e.name}`,
                    isGroup ? segments : [...segments, e.name],
                    chain
                );
            } else if (e.name === 'page.tsx') {
                pages.set('/' + segments.join('/'), [
                    `${dir}/page.tsx`,
                    ...chain,
                ]);
            }
        }
    };
    visit(`${WEB}/app`, [], []);
    return pages;
}

/** URL prefix (up to the first dynamic segment) → route handler file. */
function appApiRoutes() {
    const routes = new Map();
    for (const f of walk(join(root, WEB, 'app/api'))) {
        if (!f.endsWith('/route.ts')) continue;
        const segments = dirname(relative(join(WEB, 'app'), f)).split('/');
        const firstDynamic = segments.findIndex((s) => s.startsWith('['));
        const fixed =
            firstDynamic < 0 ? segments : segments.slice(0, firstDynamic);
        routes.set('/' + fixed.join('/'), f);
    }
    return routes;
}

function apiRoutesIn(text, apiRoutes) {
    const hits = [];
    for (const [, path] of text.matchAll(/['"`](\/api\/[\w\-/]+)/g)) {
        for (const [prefix, file] of apiRoutes) {
            if (path === prefix || path.startsWith(`${prefix}/`))
                hits.push(file);
        }
    }
    return hits;
}

/** tRPC router key (`files`) → router file, read from the appRouter. */
function trpcRouters() {
    const file = `${WEB}/server/trpc/router.ts`;
    const text = readFileSync(join(root, file), 'utf8');
    const importOf = new Map(
        [...text.matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'([^']+)'/g)].map(
            ([, name, spec]) => [name, resolveImport(spec, file)]
        )
    );
    const routers = new Map();
    for (const [, key, ident] of text.matchAll(/^\s*(\w+):\s*(\w+),?$/gm)) {
        if (importOf.get(ident)) routers.set(key, importOf.get(ident));
    }
    return routers;
}

function imports(text, from) {
    const specs = [
        // `import type` / `export type` erase at compile time: not reached.
        ...text.matchAll(
            /^\s*(?:import|export)\s+(?!type\s)[^'";]*?from\s*['"]([^'"]+)['"]/gm
        ),
        ...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
        ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    return specs.map((s) => resolveImport(s, from)).filter(Boolean);
}

let dbExports;
function resolveImport(spec, from) {
    let base;
    if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
    else if (spec.startsWith('.')) base = join(dirname(from), spec);
    else if (spec === '@nexus/db' || spec.startsWith('@nexus/db/')) {
        dbExports ??= JSON.parse(
            readFileSync(join(root, 'packages/db/package.json'), 'utf8')
        ).exports;
        const entry = dbExports['.' + spec.slice('@nexus/db'.length)];
        const target =
            typeof entry === 'string'
                ? entry
                : (entry?.import ?? entry?.default);
        return target ? join('packages/db', target) : null;
    } else return null;
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const candidate = base + ext;
        if (/\.tsx?$/.test(candidate) && existsSync(join(root, candidate)))
            return candidate;
    }
    return null;
}

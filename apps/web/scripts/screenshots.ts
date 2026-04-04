/**
 * Capture full-page + per-section screenshots of a running page.
 *
 * Usage:
 *   pnpm -F web screenshots /dashboard/admin/dev-tools
 *   pnpm -F web screenshots /dashboard/admin/dev-tools --width 768
 *
 * Requires the dev server to be running on localhost:3000.
 * Auth state is created automatically if missing or expired.
 *
 * Output: /tmp/nexus-screenshots/<route-slug>/
 *   - full-page.png
 *   - section-1-<name>.png, section-2-<name>.png, ...
 *   - preview.html (opens in browser for visual approval)
 */

import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type Locator, chromium, request } from '@playwright/test';
import {
    ADMIN_STATE_PATH,
    ADMIN_USER,
    authenticateAndSaveState,
    createUser,
    promoteToAdmin,
} from '../e2e/helpers/auth';

const BASE_URL = 'http://localhost:3000';
const DEFAULT_WIDTH = 1280;
const OUT_ROOT = '/tmp/nexus-screenshots';

// CLI parsing

function parseArgs() {
    const args = process.argv.slice(2);
    let routePath: string | undefined;
    let width = DEFAULT_WIDTH;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--width' && args[i + 1]) {
            width = parseInt(args[i + 1], 10);
            if (isNaN(width) || width < 320) {
                console.error(
                    'Invalid --width value. Must be a number >= 320.'
                );
                process.exit(1);
            }
            i++;
        } else if (!args[i].startsWith('--')) {
            routePath = args[i].startsWith('/') ? args[i] : `/${args[i]}`;
        }
    }

    if (!routePath) {
        console.error(
            'Usage: pnpm -F web screenshots <route-path> [--width <number>]'
        );
        console.error(
            'Example: pnpm -F web screenshots /dashboard/admin/dev-tools'
        );
        process.exit(1);
    }

    return { routePath, width };
}

// Dev server check

async function checkDevServer(): Promise<void> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        await fetch(BASE_URL, { signal: controller.signal });
        clearTimeout(timeout);
    } catch {
        console.error(
            `Dev server not running at ${BASE_URL}. Start it with: pnpm -F web dev`
        );
        process.exit(1);
    }
}

// Auth state

function isAuthStateValid(): boolean {
    try {
        const state = JSON.parse(readFileSync(ADMIN_STATE_PATH, 'utf8'));
        const cookie = state.cookies?.find(
            (c: { name: string }) => c.name === 'better-auth.session_token'
        );
        if (!cookie) return false;
        if (cookie.expires && cookie.expires * 1000 < Date.now()) return false;
        return true;
    } catch {
        return false;
    }
}

async function ensureAuth(): Promise<void> {
    if (isAuthStateValid()) return;

    console.error('Auth state missing or expired — creating...');
    const ctx = await request.newContext({ baseURL: BASE_URL });
    try {
        await createUser(ctx, ADMIN_USER);
        await promoteToAdmin(ADMIN_USER.email);
        await authenticateAndSaveState(ctx, ADMIN_USER, ADMIN_STATE_PATH);
        console.error('Auth state created.');
    } finally {
        await ctx.dispose();
    }
}

// Screenshot capture

async function countVisible(locator: Locator, count: number): Promise<number> {
    let visible = 0;
    for (let i = 0; i < count; i++) {
        if (await locator.nth(i).isVisible()) visible++;
    }
    return visible;
}

async function capture(
    routePath: string,
    width: number,
    outDir: string
): Promise<string[]> {
    const files: string[] = [];

    const browser = await chromium.launch();
    const context = await browser.newContext({
        storageState: ADMIN_STATE_PATH,
        viewport: { width, height: 900 },
        colorScheme: 'dark',
    });

    try {
        const page = await context.newPage();
        await page.goto(`${BASE_URL}${routePath}`, {
            waitUntil: 'networkidle',
            timeout: 10_000,
        });

        // Full page
        const fullPath = join(outDir, 'full-page.png');
        await page.screenshot({ path: fullPath, fullPage: true });
        files.push('full-page.png');
        console.error(`  captured full-page.png`);

        // Per-section: if main has a single wrapper div, go one level deeper
        let children = page.locator('main > *');
        let count = await children.count();
        const visibleAtTopLevel = await countVisible(children, count);

        if (visibleAtTopLevel === 1) {
            const deeper = page.locator('main > * > *');
            const deeperCount = await deeper.count();
            if (deeperCount > 1) {
                children = deeper;
                count = deeperCount;
            }
        }

        const SUBDIVIDE_THRESHOLD = 500; // px — subdivide sections taller than this
        const MAX_DEPTH = 2; // prevent runaway recursion

        async function captureSection(
            locator: Locator,
            prefix: string,
            depth: number,
            indent: string
        ): Promise<void> {
            const sectionAttr = await locator.getAttribute('data-section');
            const name =
                sectionAttr ??
                (depth === 0
                    ? `section-${prefix}`
                    : `child-${prefix.split('-').pop()}`);
            const filename = `${prefix}-${name}.png`;

            await locator.screenshot({ path: join(outDir, filename) });
            files.push(filename);
            console.error(`${indent}captured ${filename}`);

            if (depth >= MAX_DEPTH) return;

            const box = await locator.boundingBox();
            if (box && box.height > SUBDIVIDE_THRESHOLD) {
                const subChildren = locator.locator('> *');
                const subCount = await subChildren.count();
                if (subCount > 1) {
                    let subIdx = 0;
                    for (let j = 0; j < subCount; j++) {
                        const sub = subChildren.nth(j);
                        if (!(await sub.isVisible())) continue;
                        subIdx++;
                        const subPrefix = `${prefix}-${String(subIdx).padStart(2, '0')}`;
                        await captureSection(
                            sub,
                            subPrefix,
                            depth + 1,
                            indent + '  '
                        );
                    }
                }
            }
        }

        let visibleIdx = 0;
        for (let i = 0; i < count; i++) {
            const child = children.nth(i);
            if (!(await child.isVisible())) continue;
            visibleIdx++;
            await captureSection(
                child,
                String(visibleIdx).padStart(2, '0'),
                0,
                '  '
            );
        }
    } finally {
        await context.close();
        await browser.close();
    }

    return files;
}

// HTML preview

function generatePreview(
    outDir: string,
    files: string[],
    routePath: string
): void {
    const images = files
        .map(
            (f) => `
        <div class="section">
            <div class="label">${f.replace('.png', '')}</div>
            <img src="${f}" />
        </div>`
        )
        .join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Screenshots: ${routePath}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a;
    color: #a1a1aa;
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;
    padding: 2rem;
  }
  h1 { font-size: 0.875rem; font-weight: 500; letter-spacing: 0.05em; margin-bottom: 2rem; }
  h1 span { color: #52525b; }
  .section { margin-bottom: 2.5rem; }
  .label {
    font-size: 0.75rem;
    color: #71717a;
    margin-bottom: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: #18181b;
    border-radius: 4px;
    display: inline-block;
  }
  img {
    max-width: 100%;
    border: 1px solid #27272a;
    border-radius: 8px;
    display: block;
  }
</style>
</head>
<body>
<h1>${routePath} <span>· ${files.length} captures · ${new Date().toLocaleTimeString()}</span></h1>
${images}
</body>
</html>`;

    writeFileSync(join(outDir, 'preview.html'), html);
}

// Main

async function main() {
    const { routePath, width } = parseArgs();

    await checkDevServer();
    await ensureAuth();

    const slug = routePath.replace(/^\//, '').replace(/\//g, '-') || 'root';
    const outDir = join(OUT_ROOT, slug);

    // Clean previous captures
    if (existsSync(outDir)) rmSync(outDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    console.error(`\nCapturing ${routePath} (${width}px)...\n`);
    const files = await capture(routePath, width, outDir);

    generatePreview(outDir, files, routePath);

    console.error(`\n${files.length} screenshots saved.`);

    // Machine-readable output: just the directory path
    console.log(outDir);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});

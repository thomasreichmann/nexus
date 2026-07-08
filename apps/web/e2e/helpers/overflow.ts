import { expect, type Page } from '@playwright/test';

/**
 * Asserts the page has no horizontal layout blowout at the current viewport.
 *
 * Deliberately does NOT read `document.documentElement.scrollWidth`. The
 * dashboard shell wraps content in `overflow-hidden`, which clips any blowout
 * before the document's scrolling box ever sees it — on the genuinely broken
 * #311 dashboard, `document.scrollWidth` reads exactly the viewport width and
 * a naive check silently passes. Measured on the live bug at a 390px
 * viewport with the adversarial seed: `document.scrollWidth` = 390 while
 * `<main>` actually spans 1328px.
 *
 * Two measurements, both must hold:
 * 1. `main.scrollWidth <= main.clientWidth` — `<main>` sits inside the
 *    clipping shell, so uncontained content width still surfaces there.
 *    Overflow that a descendant properly contains (an `overflow-x-auto`
 *    table wrapper that fits the viewport) never propagates to `main`, so
 *    contained scroll passes.
 * 2. No visible element's border box extends past the viewport, unless a
 *    scrollable ancestor that itself fits the viewport contains it
 *    (contained scroll), or the element is parked fully off-canvas
 *    (closed drawers/sheets). This names the offenders on failure.
 *
 * Call it only after the page's data has rendered (wait for a seeded
 * filename first) — an empty or still-loading page passes vacuously.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
    const report = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const tolerance = 1; // subpixel rounding

        const isScrollable = (el: Element) => {
            const overflowX = getComputedStyle(el).overflowX;
            return overflowX === 'auto' || overflowX === 'scroll';
        };
        const hasFittingScrollAncestor = (el: Element): boolean => {
            for (let a = el.parentElement; a; a = a.parentElement) {
                if (!isScrollable(a)) continue;
                const rect = a.getBoundingClientRect();
                if (
                    rect.right <= viewportWidth + tolerance &&
                    rect.left >= -tolerance
                ) {
                    return true;
                }
            }
            return false;
        };
        const describe = (el: Element) => {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls =
                typeof el.className === 'string' && el.className.trim()
                    ? '.' +
                      el.className.trim().split(/\s+/).slice(0, 4).join('.')
                    : '';
            return `${tag}${id}${cls}`;
        };

        const offenders: {
            selector: string;
            left: number;
            right: number;
            width: number;
        }[] = [];
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const isSpillingRight = rect.right > viewportWidth + tolerance;
            const isSpillingLeft = rect.left < -tolerance;
            if (!isSpillingRight && !isSpillingLeft) continue;
            // Fully off-canvas = an intentional parking spot (closed
            // drawer/sheet/toast), not a blowout. Partially visible wide
            // elements stay flagged.
            if (
                rect.left >= viewportWidth - tolerance ||
                rect.right <= tolerance
            ) {
                continue;
            }
            if (getComputedStyle(el).visibility === 'hidden') continue;
            if (hasFittingScrollAncestor(el)) continue;
            offenders.push({
                selector: describe(el),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
            });
        }
        offenders.sort((a, b) => b.right - a.right);

        const main = document.querySelector('main') ?? document.body;
        return {
            viewportWidth,
            rootSelector: main === document.body ? 'body' : 'main',
            rootScrollWidth: main.scrollWidth,
            rootClientWidth: main.clientWidth,
            // Recorded so the failure output shows the naive metric lying.
            documentScrollWidth: document.documentElement.scrollWidth,
            offenders: offenders.slice(0, 8),
        };
    });

    const problems: string[] = [];
    if (report.rootScrollWidth > report.rootClientWidth + 1) {
        problems.push(
            `<${report.rootSelector}> scrollWidth ${report.rootScrollWidth} > clientWidth ${report.rootClientWidth}`
        );
    }
    for (const o of report.offenders) {
        problems.push(
            `${o.selector} spans ${o.left}..${o.right} (width ${o.width})`
        );
    }

    expect(
        problems,
        `horizontal overflow at ${report.viewportWidth}px viewport ` +
            `(document.scrollWidth reads ${report.documentScrollWidth} — ` +
            `the overflow-hidden shell masks blowouts from it, never assert on it)`
    ).toEqual([]);
}

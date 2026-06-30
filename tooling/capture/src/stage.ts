import type { Locator, Page } from '@playwright/test';

const CURSOR_ID = '__capture_cursor';

/**
 * The fake-cursor styling: a soft dot that eases between targets so the recording
 * reads as a person using the app. Playwright's video doesn't capture the real
 * pointer, so this stand-in is the only on-screen sign of intent — without it the
 * UI appears to change on its own.
 */
const CURSOR_STYLE = `
  #${CURSOR_ID} { position: fixed; z-index: 2147483647; width: 22px; height: 22px;
    margin-left: -11px; margin-top: -11px; border-radius: 9999px;
    background: rgba(255,255,255,.92);
    box-shadow: 0 0 0 2px rgba(0,0,0,.35), 0 2px 10px rgba(0,0,0,.45);
    pointer-events: none; left: 50%; top: 72%;
    transition: left .5s cubic-bezier(.22,.61,.36,1), top .5s cubic-bezier(.22,.61,.36,1), transform .12s ease; }
  #${CURSOR_ID}.tap { transform: scale(.65); }
`;

/**
 * A thin, recording-aware wrapper over a Playwright page. It drives the page
 * through a fake cursor and tracks when the first real action happens, so the
 * runner can trim the load/settle head off the final clip automatically.
 */
export class Stage {
    private firstActionAt: number | null = null;

    constructor(
        private readonly page: Page,
        private readonly baseUrl: string,
        private readonly startedAt: number
    ) {}

    /** Escape hatch to the underlying page for anything the helpers don't cover. */
    get raw(): Page {
        return this.page;
    }

    /** Offset in seconds of the first action on the video clock; null if nothing was driven. */
    get firstActionOffset(): number | null {
        return this.firstActionAt === null ? null : this.firstActionAt / 1000;
    }

    async goto(path: string): Promise<void> {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        // domcontentloaded, not networkidle — the latter never settles against
        // Next dev/HMR traffic; the explicit waitFor in a scene is the real gate.
        await this.page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 90_000,
        });
        await this.injectCursor();
    }

    /** Wait for a key element before driving. */
    async waitFor(selector: string, timeoutMs = 45_000): Promise<void> {
        await this.page.waitForSelector(selector, { timeout: timeoutMs });
    }

    /** Hold on the loaded, idle UI so entry animations and the first render finish. */
    async settle(ms = 1400): Promise<void> {
        await this.page.waitForTimeout(ms);
    }

    async pause(ms = 900): Promise<void> {
        await this.page.waitForTimeout(ms);
    }

    /** Glide the cursor to a target and click it, with a brief press animation. */
    async moveClick(target: Locator, holdMs = 1300): Promise<void> {
        this.markAction();
        await this.glideTo(target);
        await this.setTap(true);
        await this.page.waitForTimeout(130);
        await target.click();
        await this.setTap(false);
        await this.page.waitForTimeout(holdMs);
    }

    /** Glide the cursor to a target and rest on it (real hover, no click). */
    async move(target: Locator, holdMs = 1100): Promise<void> {
        this.markAction();
        await this.glideTo(target);
        await target.hover();
        await this.page.waitForTimeout(holdMs);
    }

    /** Move the cursor to a field and type into it, replacing any current value. */
    async type(target: Locator, text: string, perCharMs = 55): Promise<void> {
        this.markAction();
        await this.glideTo(target);
        await target.click();
        await target.fill('');
        await this.page.keyboard.type(text, { delay: perCharMs });
        await this.page.waitForTimeout(900);
    }

    private markAction(): void {
        if (this.firstActionAt === null)
            this.firstActionAt = Date.now() - this.startedAt;
    }

    private async glideTo(target: Locator): Promise<void> {
        // Scroll first, smoothly. Playwright's own scrollIntoViewIfNeeded snaps
        // the scroll position in a single frame — on a recording that reads as a
        // hard splice. Animating it keeps the list moving under the cursor like a
        // real wheel scroll.
        await this.smoothScrollIntoView(target);
        const box = await target.boundingBox();
        if (!box)
            throw new Error(
                'Target has no bounding box (off-screen or not rendered?).'
            );
        const x = Math.round(box.x + box.width / 2);
        const y = Math.round(box.y + box.height / 2);
        await this.page.evaluate(
            ({ id, x, y }: { id: string; x: number; y: number }) => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.left = `${x}px`;
                    el.style.top = `${y}px`;
                }
            },
            { id: CURSOR_ID, x, y }
        );
        // Match the CSS ease duration so the click lands once the dot has arrived.
        await this.page.waitForTimeout(620);
    }

    /**
     * Animate the nearest scrollable ancestor so `target` ends up centred, easing
     * over `durationMs`. Returns having waited only if it actually scrolled.
     */
    private async smoothScrollIntoView(
        target: Locator,
        durationMs = 650
    ): Promise<void> {
        // Measure the scroll in the page, tag the scroller, then ease scrollTop
        // from Node. The browser functions deliberately have no inner named
        // helpers: tsx/esbuild's keepNames would wrap them in a `__name()` call
        // that isn't defined once Playwright serializes them into the page.
        const plan = await target.evaluate((el: HTMLElement) => {
            const stale = document.querySelectorAll('[data-capture-scroll]');
            for (let k = 0; k < stale.length; k++)
                stale[k]!.removeAttribute('data-capture-scroll');

            let node: HTMLElement | null = el.parentElement;
            while (node) {
                const s = getComputedStyle(node);
                if (
                    /(auto|scroll)/.test(s.overflowY) &&
                    node.scrollHeight > node.clientHeight + 1
                )
                    break;
                node = node.parentElement;
            }
            const scroller: Element =
                node ?? document.scrollingElement ?? document.documentElement;
            const usingWindow = node === null;
            const viewTop = usingWindow
                ? 0
                : scroller.getBoundingClientRect().top;
            const viewHeight = usingWindow
                ? window.innerHeight
                : scroller.clientHeight;
            const rect = el.getBoundingClientRect();
            const start = scroller.scrollTop;
            const desired =
                start + (rect.top - viewTop) - viewHeight / 2 + rect.height / 2;
            const max = scroller.scrollHeight - scroller.clientHeight;
            const end = Math.max(0, Math.min(desired, max));
            scroller.setAttribute('data-capture-scroll', '1');
            return { start, end };
        });

        const clear = (): Promise<void> =>
            this.page.evaluate(() => {
                const sc = document.querySelector('[data-capture-scroll]');
                if (sc) sc.removeAttribute('data-capture-scroll');
            });

        const delta = plan.end - plan.start;
        if (Math.abs(delta) < 4) {
            await clear();
            return;
        }

        const steps = Math.max(2, Math.round(durationMs / 28));
        for (let i = 1; i <= steps; i++) {
            const p = i / steps;
            const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            const y = plan.start + delta * eased;
            await this.page.evaluate((top: number) => {
                const sc = document.querySelector('[data-capture-scroll]');
                if (sc) sc.scrollTop = top;
            }, y);
            await this.page.waitForTimeout(Math.round(durationMs / steps));
        }
        await clear();
    }

    private async setTap(on: boolean): Promise<void> {
        await this.page.evaluate(
            ({ id, on }: { id: string; on: boolean }) => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('tap', on);
            },
            { id: CURSOR_ID, on }
        );
    }

    private async injectCursor(): Promise<void> {
        await this.page.addStyleTag({ content: CURSOR_STYLE });
        await this.page.evaluate((id: string) => {
            if (document.getElementById(id)) return;
            const el = document.createElement('div');
            el.id = id;
            document.body.appendChild(el);
        }, CURSOR_ID);
    }
}

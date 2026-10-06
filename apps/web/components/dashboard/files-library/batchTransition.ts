/**
 * The library -> batch choreography from the #455 motion study ("Batch Open
 * Transition" artifact), ported to the live DOM. It is imperative on purpose:
 * WAAPI over measured rects, ghosts in an overlay layer, the real elements
 * held invisible until each ghost lands. React renders both views for the
 * length of a transition and hands this module their roots; elements are
 * found by their `data-fx` markers.
 */

import { EASE, readSlowMotion, spring, type Rect } from './motion';

interface AnimOptions {
    d?: number;
    delay?: number;
    e?: string;
    fill?: FillMode;
}

export interface TransitionRoots {
    library: HTMLElement;
    split: HTMLElement;
    /** Overlay the ghosts fly in; covers the views, never takes clicks. */
    fx: HTMLElement;
    /** The page's scroll container, for clamping and scroll-into-view. */
    scroller: HTMLElement | null;
}

export interface BatchTransitions {
    open(key: string): Promise<void>;
    close(key: string, restoreScrollTop: number): Promise<void>;
    switchOut(): Promise<void>;
    switchIn(): Promise<void>;
    finish(): void;
}

interface LandingSpots {
    /** The open row's thumbnail; null on phone, which has no batch list. */
    thumb: HTMLElement | null;
    /** On phone, the grid tiles the cover photos land on. */
    tiles: HTMLElement[];
    /** One per cover piece; null where a piece has nowhere to land. */
    spots: (HTMLElement | null)[];
    radii: string[];
}

// Corner radii of the three mosaic pieces in each place they can sit.
const RADII = {
    cover: ['11px 0 0 0', '0 11px 0 0', '0'],
    thumb: ['6px 0 0 6px', '0 6px 0 0', '0 0 6px 0'],
    tile: ['8px', '8px', '8px'],
};

const fx = (name: string) => `[data-fx="${name}"]`;
const LIB_CHROME = fx('lib-chrome');
const PANE_CHROME = `${fx('pane-chrome')}, ${fx('paging')}`;

const $ = (selector: string, root: ParentNode): HTMLElement | null =>
    root.querySelector<HTMLElement>(selector);
const $$ = (selector: string, root: ParentNode): HTMLElement[] => [
    ...root.querySelectorAll<HTMLElement>(selector),
];
const isVisible = (el: Element | null | undefined): el is HTMLElement =>
    !!el && el.getClientRects().length > 0;
const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
const box = (r: Rect, extra: Keyframe = {}): Keyframe => ({
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
    ...extra,
});
const colsOf = (grid: HTMLElement | null): number =>
    grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;

export function createBatchTransitions(
    roots: TransitionRoots
): BatchTransitions {
    const { library: lib, split: sp, fx: layer } = roots;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const S = readSlowMotion();
    const SP = {
        hero: spring(90, 16),
        pop: spring(420, 15, 'cubic-bezier(.34,1.56,.64,1)'),
    };
    let running: Animation[] = [];
    const held = new Set<HTMLElement>();
    const framed = new Set<HTMLElement>();

    function A(
        el: HTMLElement,
        frames: Keyframe[],
        o: AnimOptions = {}
    ): Animation {
        const a = el.animate(frames, {
            duration: (o.d ?? 300) * S,
            delay: (o.delay ?? 0) * S,
            easing: o.e ?? EASE.emph,
            fill: o.fill ?? 'both',
        });
        running.push(a);
        return a;
    }
    const fin = (a: Animation) => a.finished.then(noop, noop);
    const all = (list: Animation[]) => Promise.all(list.map(fin));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms * S));

    function rel(el: Element): Rect {
        const o = layer.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return {
            x: r.left - o.left,
            y: r.top - o.top,
            w: r.width,
            h: r.height,
        };
    }

    // Held elements are laid out but invisible until their entrance plays;
    // framed ones keep their contents but drop their own background and
    // border, so a ghost can stand in for the frame.
    function hold(els: (HTMLElement | null | undefined)[]) {
        for (const el of els) {
            if (!el) continue;
            el.style.opacity = '0';
            held.add(el);
        }
    }
    function unhold(el: HTMLElement | null | undefined) {
        if (!el) return;
        el.style.removeProperty('opacity');
        held.delete(el);
    }
    function frameHold(els: (HTMLElement | null | undefined)[]) {
        for (const el of els) {
            if (!el) continue;
            el.style.setProperty('background', 'transparent', 'important');
            el.style.setProperty('border-color', 'transparent', 'important');
            framed.add(el);
        }
    }
    function unframe(el: HTMLElement | null | undefined) {
        if (!el) return;
        el.style.removeProperty('background');
        el.style.removeProperty('border-color');
        framed.delete(el);
    }

    // A ghost keeps its data-fx markers: it lives in the overlay, outside
    // both view roots, so no view query can pick it up.
    function ghost(el: HTMLElement, r: Rect): HTMLElement {
        const g = el.cloneNode(true) as HTMLElement;
        for (const node of [g, ...g.querySelectorAll<HTMLElement>('[id]')]) {
            node.removeAttribute('id');
        }
        g.setAttribute('aria-hidden', 'true');
        g.setAttribute('tabindex', '-1');
        g.style.removeProperty('opacity');
        g.style.removeProperty('background');
        g.style.removeProperty('border-color');
        Object.assign(g.style, {
            position: 'absolute',
            margin: '0',
            boxSizing: 'border-box',
            overflow: 'hidden',
            transform: 'none',
            transition: 'none',
            left: `${r.x}px`,
            top: `${r.y}px`,
            width: `${r.w}px`,
            height: `${r.h}px`,
        });
        layer.append(g);
        return g;
    }

    // Wait until every animation is done. One whose element has already left
    // the page (a removed ghost) never reports finished, so it is cancelled.
    async function settle() {
        for (;;) {
            for (const a of running) {
                const target = (a.effect as KeyframeEffect | null)?.target;
                if (target && !target.isConnected && a.playState === 'running')
                    a.cancel();
            }
            const live = running.filter((a) => a.playState === 'running');
            if (!live.length) return;
            await Promise.race([all(live), wait(120)]);
        }
    }

    function finish() {
        for (const el of [...held]) unhold(el);
        for (const el of [...framed]) unframe(el);
        for (const a of running) a.cancel();
        running = [];
        layer.replaceChildren();
    }

    // The ghost pane never needs to be taller than what can be on screen; a
    // 2,000px-tall frame just grows off the bottom of the viewport.
    const clampToViewport = (r: Rect): Rect => ({
        ...r,
        h: Math.min(r.h, roots.scroller?.clientHeight ?? window.innerHeight),
    });

    function scrollTo(top: number) {
        roots.scroller?.scrollTo({
            top: Math.max(0, top),
            behavior: reducedMotion.matches ? 'auto' : 'smooth',
        });
    }
    // The split opens at the top of the stage. If the library was scrolled
    // past that, pan up while it plays: ghosts live in content coordinates,
    // so they ride the scroll with everything else.
    function revealStageTop() {
        const scroller = roots.scroller;
        if (!scroller) return;
        const offset =
            layer.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top;
        if (offset < 0) scrollTo(scroller.scrollTop + offset - 24);
    }

    // Toss each of a mosaic's three photos into its new slot along an arc,
    // one after the other.
    function arcPieces(
        sources: (HTMLElement | null | undefined)[],
        from: (Rect | null | undefined)[],
        to: (Rect | null | undefined)[],
        fromRadii: string[],
        toRadii: string[],
        delay: number,
        o: { d?: number; gap?: number; lift?: number } = {}
    ) {
        const ghosts: HTMLElement[] = [];
        const anims: Animation[] = [];
        const D = o.d ?? 920;
        const gap = o.gap ?? 65;
        const lift = o.lift ?? 28;
        const tilt = [-3, 2.5, -2];
        sources.forEach((el, j) => {
            const f = from[j];
            const t = to[j];
            if (!el || !f || !t) return;
            const g = ghost(el, f);
            g.style.zIndex = '1';
            $$(`${fx('badge')}, [data-fx-decor], svg`, g).forEach((x) =>
                x.remove()
            );
            ghosts.push(g);
            const dl = delay + j * gap;
            const apex = Math.min(f.y, t.y) - lift;
            // x and y ride different curves, which draws an arc: up and
            // over, then down into the slot.
            anims.push(
                A(
                    g,
                    [
                        {
                            left: `${f.x}px`,
                            easing: 'cubic-bezier(.45,0,.2,1)',
                        },
                        { left: `${t.x}px` },
                    ],
                    { d: D, delay: dl, e: 'linear' }
                ),
                A(
                    g,
                    [
                        {
                            top: `${f.y}px`,
                            easing: 'cubic-bezier(.25,.7,.4,1)',
                        },
                        {
                            top: `${apex}px`,
                            offset: 0.38,
                            easing: 'cubic-bezier(.55,0,.3,1)',
                        },
                        { top: `${t.y}px` },
                    ],
                    { d: D, delay: dl, e: 'linear' }
                ),
                A(
                    g,
                    [
                        {
                            width: `${f.w}px`,
                            height: `${f.h}px`,
                            borderRadius: fromRadii[j],
                            easing: 'cubic-bezier(.55,0,.25,1)',
                        },
                        {
                            width: `${t.w}px`,
                            height: `${t.h}px`,
                            borderRadius: toRadii[j],
                        },
                    ],
                    { d: D, delay: dl, e: 'linear' }
                )
            );
            A(
                g,
                [
                    { transform: 'none', boxShadow: '0 0 0 rgba(0,0,0,0)' },
                    {
                        transform: `scale(1.06) rotate(${tilt[j]}deg)`,
                        boxShadow: '0 14px 30px rgba(0,0,0,.5)',
                        offset: 0.4,
                    },
                    { transform: 'none', boxShadow: '0 0 0 rgba(0,0,0,0)' },
                ],
                { d: D, delay: dl, e: EASE.std }
            );
        });
        return {
            done: all(anims).then(() => ghosts.forEach((g) => g.remove())),
        };
    }

    function libChromeOut() {
        $$(LIB_CHROME, lib).forEach((el, i) =>
            A(
                el,
                [
                    { opacity: 1, transform: 'none' },
                    { opacity: 0, transform: 'translateY(-6px)' },
                ],
                { d: 200, delay: i * 25, e: EASE.accel }
            )
        );
    }
    function libChromeIn(at: number) {
        $$(LIB_CHROME, lib).forEach((el, i) =>
            A(
                el,
                [
                    { opacity: 0, transform: 'translateY(6px)' },
                    { opacity: 1, transform: 'none' },
                ],
                { d: 340, delay: at + i * 40, e: EASE.decel }
            )
        );
    }

    // Tiles below the fold don't stagger in: they'd finish long after the
    // transition reads as done, and nobody sees them land.
    function tilesInView(tiles: HTMLElement[]): HTMLElement[] {
        const limit = roots.scroller?.clientHeight ?? window.innerHeight;
        return tiles.filter((t) => rel(t).y < limit);
    }

    // Everything in the split the choreography reveals starts held.
    function holdSplit() {
        hold([
            $(fx('crumbs'), sp),
            ...$$(fx('list-chrome'), sp),
            ...$$(PANE_CHROME, sp),
            ...$$('[data-fx-row]', sp),
            $(fx('pane-title'), sp),
            ...$$(fx('tile'), sp),
        ]);
        frameHold([$(fx('pane'), sp), $(fx('list'), sp)]);
    }

    interface PaneInOptions {
        meta: number;
        tiles: number;
        step?: number;
        tileD?: number;
        skip?: Set<HTMLElement>;
    }
    function paneIn(o: PaneInOptions) {
        const pane = $(fx('pane'), sp);
        if (!pane) return;
        $$(fx('pane-chrome'), pane).forEach((el, i) =>
            A(
                el,
                [
                    { opacity: 0, transform: 'translateY(6px)' },
                    { opacity: 1, transform: 'none' },
                ],
                { d: 340, delay: o.meta + i * 50, e: EASE.decel }
            )
        );
        const grid = $(fx('tiles'), pane);
        const cols = colsOf(grid);
        const tiles = $$(fx('tile'), pane);
        const animated = new Set(tilesInView(tiles));
        let lastDelay = o.tiles;
        tiles.forEach((t, i) => {
            if (o.skip?.has(t)) return;
            if (!animated.has(t)) return;
            const row = Math.floor(i / cols);
            const col = i % cols;
            const delay = o.tiles + (row + col) * (o.step ?? 36);
            lastDelay = Math.max(lastDelay, delay);
            A(
                t,
                [
                    {
                        opacity: 0,
                        transform: 'translateY(12px) scale(.9)',
                        filter: 'blur(5px)',
                    },
                    { opacity: 1, transform: 'none', filter: 'blur(0px)' },
                ],
                { d: o.tileD ?? 460, delay, e: EASE.decel }
            );
        });
        // Off-screen tiles appear with the last visible one.
        tiles.forEach((t) => {
            if (!animated.has(t) && !o.skip?.has(t))
                A(t, [{ opacity: 0 }, { opacity: 1 }], {
                    d: 1,
                    delay: lastDelay,
                });
        });
        $$(fx('paging'), pane).forEach((el) =>
            A(el, [{ opacity: 0 }, { opacity: 1 }], {
                d: 300,
                delay: lastDelay + 200,
            })
        );
        const bar = $(fx('status-bar'), pane);
        if (bar)
            A(bar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
                d: 760,
                delay: o.tiles + 380,
                e: EASE.emph,
            });
        // A restoring batch can badge every tile on screen; the cascade is
        // capped so the pops land as one gesture, not a three-second tail.
        $$(fx('badge'), pane)
            .filter((b) => isVisible(b) && tilesInView([b]).length > 0)
            .forEach((el, i) =>
                A(el, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
                    d: SP.pop.d,
                    e: SP.pop.e,
                    delay: o.tiles + 460 + Math.min(i, 10) * 45,
                })
            );
    }

    function splitChromeIn(
        o: PaneInOptions & { crumbs: number; list: number }
    ) {
        const crumbs = $(fx('crumbs'), sp);
        if (crumbs)
            A(
                crumbs,
                [
                    { opacity: 0, transform: 'translateX(-10px)' },
                    { opacity: 1, transform: 'none' },
                ],
                { d: 360, delay: o.crumbs, e: EASE.decel }
            );
        $$(fx('list-chrome'), sp).forEach((el, i) =>
            A(el, [{ opacity: 0 }, { opacity: 1 }], {
                d: 280,
                delay: o.list + i * 240,
            })
        );
        paneIn(o);
    }

    function splitChromeOut(skip?: Set<HTMLElement>) {
        const crumbs = $(fx('crumbs'), sp);
        if (crumbs)
            A(crumbs, [{ opacity: 1 }, { opacity: 0 }], {
                d: 160,
                e: EASE.accel,
            });
        $$(fx('list-chrome'), sp).forEach((el) =>
            A(el, [{ opacity: 1 }, { opacity: 0 }], { d: 160, e: EASE.accel })
        );
        $$(PANE_CHROME, sp).forEach((el) =>
            A(
                el,
                [
                    { opacity: 1, transform: 'none' },
                    { opacity: 0, transform: 'translateY(-4px)' },
                ],
                { d: 180, e: EASE.accel }
            )
        );
        const grid = $(fx('tiles'), sp);
        const cols = colsOf(grid);
        const tiles = $$(fx('tile'), sp);
        const inView = new Set(tilesInView(tiles));
        const diag = (i: number) => Math.floor(i / cols) + (i % cols);
        // The stagger runs bottom-right to top-left across what's on screen;
        // counting off-screen rows would hold the top tiles back for nothing.
        const maxD = Math.max(
            0,
            ...tiles
                .filter((t) => inView.has(t))
                .map((t) => diag(tiles.indexOf(t)))
        );
        tiles.forEach((t, i) => {
            if (skip?.has(t)) return;
            if (!inView.has(t)) {
                A(t, [{ opacity: 1 }, { opacity: 0 }], { d: 1 });
                return;
            }
            A(
                t,
                [
                    { opacity: 1, transform: 'none' },
                    { opacity: 0, transform: 'scale(.88)' },
                ],
                { d: 200, delay: (maxD - diag(i)) * 16, e: EASE.accel }
            );
        });
    }

    // The clicked card dips like a pressed key.
    const press = (card: HTMLElement) =>
        fin(
            A(card, [{ transform: 'scale(1)' }, { transform: 'scale(.965)' }], {
                d: 110,
                e: EASE.std,
            })
        );

    // FLIP a text ghost that sits at `to` so it starts visually at `from`.
    function flipText(g: HTMLElement, from: Rect, to: Rect, o: AnimOptions) {
        g.style.transformOrigin = '0 0';
        return A(
            g,
            [
                {
                    transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.h / to.h})`,
                },
                { transform: 'none' },
            ],
            o
        );
    }

    function othersByDistance(cards: HTMLElement[], card: HTMLElement) {
        const [ox, oy] = center(rel(card));
        return cards
            .filter((c) => c !== card)
            .map((c) => {
                const [x, y] = center(rel(c));
                return { c, dist: Math.hypot(x - ox, y - oy) };
            })
            .sort((a, z) => a.dist - z.dist)
            .map((o) => o.c);
    }

    // Where a batch's three cover photos sit in the split: its row's
    // thumbnail in the batch list, or — phone has no list — their own tiles
    // in the grid.
    function landingSpots(
        openRow: HTMLElement | undefined,
        pieces: HTMLElement[]
    ): LandingSpots {
        const thumb = openRow && $(fx('thumb'), openRow);
        if (thumb) {
            return {
                thumb,
                tiles: [],
                spots: $$(fx('piece'), thumb),
                radii: RADII.thumb,
            };
        }
        const allTiles = $$(fx('tile'), sp);
        const tiles = pieces.map(
            (p) =>
                allTiles.find(
                    (t) =>
                        !!p.dataset.fileId &&
                        t.dataset.fileId === p.dataset.fileId
                ) ?? null
        );
        return {
            thumb: null,
            tiles: tiles.filter((t): t is HTMLElement => !!t),
            spots: tiles.map((t) => t && $(fx('tile-media'), t)),
            radii: RADII.tile,
        };
    }

    /* ---- Open: the opened batch's photos arc into its place in the list;
       the library steps back ---- */
    async function open(key: string) {
        if (reducedMotion.matches) return fadeBetween(lib, sp);
        const cards = $$('[data-fx-card]', lib);
        const card = cards.find((c) => c.dataset.fxCard === key);
        const pane = $(fx('pane'), sp);
        const title = $(fx('pane-title'), sp);
        const list = $(fx('list'), sp);
        if (!card || !pane || !title) return fadeBetween(lib, sp);

        const paneBorder = getComputedStyle(pane).borderTopColor;
        holdSplit();
        unframe(list);
        hold([list]);
        revealStageTop();

        const rows = $$('[data-fx-row]', sp);
        const coverPieces = $$(`${fx('cover')} ${fx('piece')}`, card);
        const m = {
            card: rel(card),
            name: rel($(fx('card-name'), card) ?? card),
            pieces: coverPieces.map(rel),
            border: getComputedStyle(card).borderTopColor,
        };
        const openRow = rows.find(
            (r) => r.dataset.fxRow === key && isVisible(r)
        );
        const landing = landingSpots(openRow, coverPieces);
        const { thumb } = landing;
        const targets = landing.spots.map((s) => s && rel(s));
        hold([thumb]);
        const paneR = clampToViewport(rel(pane));
        const titleR = rel(title);
        // The real pane takes over from its stand-in once the spring is
        // visually settled.
        const swap = Math.round(SP.hero.d * 0.72);
        const others = othersByDistance(cards, card);

        await press(card);
        libChromeOut();

        // The rest of the library steps back toward the sidebar: a quiet
        // backdrop for the one batch that moves.
        others.forEach((c, k) =>
            A(
                c,
                [
                    { opacity: 1, transform: 'none', filter: 'blur(0px)' },
                    {
                        opacity: 0,
                        transform: 'translateX(-28px) scale(.96)',
                        filter: 'blur(3px)',
                    },
                ],
                { d: 380, delay: 40 + Math.min(k, 16) * 28, e: EASE.accel }
            )
        );

        // The opened card grows into the batch pane, its name rising into
        // the title. It rides above the library so the receding cards stay
        // behind it.
        const pg = ghost(card, m.card);
        $$(`${fx('piece')}, ${fx('card-name')}`, pg).forEach(
            (t) => (t.style.visibility = 'hidden')
        );
        const pill = $(fx('pill'), pg);
        if (pill) A(pill, [{ opacity: 1 }, { opacity: 0 }], { d: 120 });
        hold([card]);
        const body = $(fx('card-body'), pg);
        if (body)
            A(body, [{ opacity: 1 }, { opacity: 0 }], { d: 200, e: EASE.std });
        A(pg, [{ transform: 'scale(.965)' }, { transform: 'none' }], {
            d: 320,
            e: EASE.decel,
        });
        A(
            pg,
            [
                { boxShadow: '0 0 0 rgba(0,0,0,0)' },
                { boxShadow: '0 30px 90px rgba(0,0,0,.55)', offset: 0.4 },
                { boxShadow: '0 0 0 rgba(0,0,0,0)' },
            ],
            { d: SP.hero.d, e: 'linear' }
        );
        A(
            pg,
            [
                box(m.card, { borderColor: m.border }),
                box(paneR, { borderColor: paneBorder }),
            ],
            { d: SP.hero.d, e: SP.hero.e }
        );
        void wait(swap).then(() => {
            // Cancel before removing: an animation on a detached element
            // never reports finished.
            pg.getAnimations({ subtree: true }).forEach((a) => a.cancel());
            pg.remove();
            unframe(pane);
        });
        const tg = ghost(title, titleR);
        tg.style.whiteSpace = 'nowrap';
        tg.style.overflow = 'visible';
        void fin(
            flipText(tg, m.name, titleR, {
                d: SP.hero.d,
                e: SP.hero.e,
                delay: 60,
            })
        ).then(() => {
            tg.remove();
            unhold(title);
        });

        // Its three cover photos arc over, one after another, into its
        // thumbnail in the list.
        const p = arcPieces(
            coverPieces,
            m.pieces,
            targets,
            RADII.cover,
            landing.radii,
            120
        );

        // The list slides in around them; the opened batch's row waits for
        // its photos.
        if (list)
            A(
                list,
                [
                    { opacity: 0, transform: 'translateX(-12px)' },
                    { opacity: 1, transform: 'none' },
                ],
                { d: 420, delay: 260, e: EASE.decel }
            );
        rows.forEach((r, i) => {
            if (r === openRow)
                A(r, [{ opacity: 0 }, { opacity: 1 }], { d: 300, delay: 300 });
            else
                A(
                    r,
                    [
                        { opacity: 0, transform: 'translateX(-14px)' },
                        { opacity: 1, transform: 'none' },
                    ],
                    {
                        d: 440,
                        delay: 360 + Math.min(i, 16) * 45,
                        e: EASE.decel,
                    }
                );
        });
        let skip: Set<HTMLElement> | undefined;
        if (openRow && thumb) {
            const rowBg = getComputedStyle(openRow).backgroundColor;
            // The last photo lands: the thumbnail snaps together and the row
            // lights up as the current batch.
            void p.done.then(() => {
                unhold(thumb);
                A(
                    thumb,
                    [{ transform: 'scale(1.18)' }, { transform: 'none' }],
                    {
                        d: SP.pop.d,
                        e: SP.pop.e,
                    }
                );
                A(
                    openRow,
                    [
                        { background: rowBg },
                        { background: 'rgba(43,127,255,.34)', offset: 0.25 },
                        { background: rowBg },
                    ],
                    { d: 760, e: EASE.std }
                );
            });
        } else {
            skip = new Set(landing.tiles);
            void p.done.then(() => landing.tiles.forEach((t) => unhold(t)));
        }
        splitChromeIn({
            crumbs: 260,
            list: 340,
            meta: swap - 20,
            tiles: swap + 40,
            step: 46,
            tileD: 540,
            skip,
        });
        await settle();
        lib.hidden = true;
        finish();
    }

    /* ---- Close: the reverse, photos lifting back into the cover ---- */
    async function close(key: string, restoreScrollTop: number) {
        if (reducedMotion.matches) {
            scrollTo(restoreScrollTop);
            return fadeBetween(sp, lib);
        }
        const cards = $$('[data-fx-card]', lib);
        const card = cards.find((c) => c.dataset.fxCard === key);
        const pane = $(fx('pane'), sp);
        const title = $(fx('pane-title'), sp);
        const list = $(fx('list'), sp);
        if (!card || !pane || !title) {
            scrollTo(restoreScrollTop);
            return fadeBetween(sp, lib);
        }
        hold([card, ...$$(LIB_CHROME, lib)]);
        const paneStyle = getComputedStyle(pane);
        const rows = $$('[data-fx-row]', sp);
        const coverPieces = $$(`${fx('cover')} ${fx('piece')}`, card);
        const target = {
            card: rel(card),
            name: rel($(fx('card-name'), card) ?? card),
            pieces: coverPieces.map(rel),
        };
        const openRow = rows.find(
            (r) => r.dataset.fxRow === key && isVisible(r)
        );
        const landing = landingSpots(openRow, coverPieces);
        const sourceRects = landing.spots.map((s) => s && rel(s));
        const paneR = clampToViewport(rel(pane));
        const titleR = rel(title);
        const others = othersByDistance(cards, card);
        const skip = new Set(landing.tiles);
        scrollTo(restoreScrollTop);
        splitChromeOut(skip);

        // The list slides away while the opened batch's photos lift out of
        // its thumbnail and arc back into the cover.
        rows.forEach((r, i) => {
            if (r !== openRow)
                A(
                    r,
                    [
                        { opacity: 1, transform: 'none' },
                        { opacity: 0, transform: 'translateX(-14px)' },
                    ],
                    { d: 280, delay: Math.min(i, 16) * 25, e: EASE.accel }
                );
        });
        if (openRow) {
            const rowText = $(fx('row-text'), openRow);
            if (rowText)
                A(rowText, [{ opacity: 1 }, { opacity: 0 }], {
                    d: 200,
                    e: EASE.accel,
                });
            A(
                openRow,
                [
                    { background: getComputedStyle(openRow).backgroundColor },
                    { background: 'transparent' },
                ],
                { d: 300, delay: 200 }
            );
        }
        hold([landing.thumb, ...landing.tiles]);
        if (list)
            A(list, [{ opacity: 1 }, { opacity: 0 }], {
                d: 320,
                delay: 420,
                e: EASE.std,
            });
        const p = arcPieces(
            landing.spots,
            sourceRects,
            target.pieces,
            landing.radii,
            RADII.cover,
            80,
            { lift: 22 }
        );

        // The pane shrinks back into the card and the title returns to its
        // name. It rides above the returning library, under the flying
        // photos and title.
        const pg = document.createElement('div');
        pg.setAttribute('aria-hidden', 'true');
        Object.assign(pg.style, {
            position: 'absolute',
            boxSizing: 'border-box',
            overflow: 'hidden',
            background: paneStyle.backgroundColor,
            border: `1px solid ${paneStyle.borderTopColor}`,
            borderRadius: paneStyle.borderTopLeftRadius,
            left: `${paneR.x}px`,
            top: `${paneR.y}px`,
            width: `${paneR.w}px`,
            height: `${paneR.h}px`,
        });
        layer.prepend(pg);
        A(pg, [{ opacity: 0 }, { opacity: 1 }], {
            d: 160,
            delay: 100,
            e: EASE.std,
        });
        const cardBody = $(fx('card-body'), card);
        if (cardBody) {
            const cb = cardBody.cloneNode(true) as HTMLElement;
            Object.assign(cb.style, {
                position: 'absolute',
                left: '0',
                right: '0',
                bottom: '0',
            });
            const cbName = $(fx('card-name'), cb);
            if (cbName) cbName.style.visibility = 'hidden';
            pg.append(cb);
            A(cb, [{ opacity: 0 }, { opacity: 1 }], {
                d: 260,
                delay: 160 + SP.hero.d * 0.55,
            });
        }
        const pa = A(pg, [box(paneR), box(target.card)], {
            d: SP.hero.d,
            e: SP.hero.e,
            delay: 160,
        });
        frameHold([pane]);
        hold([title]);
        const nameEl = $(fx('card-name'), card) ?? title;
        const tg = ghost(nameEl, target.name);
        tg.style.whiteSpace = 'nowrap';
        tg.style.overflow = 'visible';
        const ta = flipText(tg, titleR, target.name, {
            d: SP.hero.d,
            e: SP.hero.e,
            delay: 160,
        });
        void Promise.all([fin(pa), fin(ta), p.done]).then(() => {
            tg.remove();
            pg.remove();
            unhold(card);
            const pill = $(fx('pill'), card);
            A(pill ?? card, [{ opacity: 0 }, { opacity: 1 }], { d: 220 });
        });

        // The rest of the library steps forward again.
        others.forEach((c, k) =>
            A(
                c,
                [
                    {
                        opacity: 0,
                        transform: 'translateX(-28px) scale(.96)',
                        filter: 'blur(3px)',
                    },
                    { opacity: 1, transform: 'none', filter: 'blur(0px)' },
                ],
                { d: 520, delay: 440 + Math.min(k, 16) * 35, e: EASE.decel }
            )
        );
        libChromeIn(380);
        await settle();
        sp.hidden = true;
        finish();
    }

    /* ---- Switching batches from the list: the pane re-deals ---- */
    async function switchOut() {
        const pane = $(fx('pane'), sp);
        if (!pane || reducedMotion.matches) return;
        // Left filled at opacity 0: React swaps the contents next, and
        // switchIn clears this before the new batch paints.
        await fin(
            A(pane, [{ opacity: 1 }, { opacity: 0 }], {
                d: 120,
                e: EASE.accel,
                fill: 'forwards',
            })
        );
    }
    async function switchIn() {
        finish();
        const pane = $(fx('pane'), sp);
        if (!pane || reducedMotion.matches) return;
        hold([...$$(PANE_CHROME, pane), ...$$(fx('tile'), pane)]);
        A(pane, [{ opacity: 0 }, { opacity: 1 }], { d: 120 });
        paneIn({ meta: 0, tiles: 60 });
        await settle();
        finish();
    }

    /* ---- Reduced motion: a short crossfade ---- */
    async function fadeBetween(from: HTMLElement, to: HTMLElement) {
        A(from, [{ opacity: 1 }, { opacity: 0 }], { d: 160 });
        A(to, [{ opacity: 0 }, { opacity: 1 }], { d: 160 });
        await settle();
        from.hidden = true;
        finish();
    }

    return { open, close, switchOut, switchIn, finish };
}

function noop() {}

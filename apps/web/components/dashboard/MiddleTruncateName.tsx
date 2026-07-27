'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/* Tail length for middle truncation. Burst shots share a prefix and differ
   only in the trailing digits, and the extension (.dng vs .jpg) is real
   information — so the end of the name must survive truncation, not the
   start. 12 graphemes covers "<counter>.<ext>". */
const NAME_TAIL_GRAPHEMES = 12;

/* Grapheme splitting depends only on the name, never the wrapper width — the
   Segmenter is stateless, so one shared instance serves every call and each
   name is segmented once (memoized in the component). The old code built a
   fresh Segmenter and re-split the whole string on every ResizeObserver tick. */
const graphemeSegmenter = new Intl.Segmenter();

function segmentGraphemes(name: string): string[] {
    return Array.from(graphemeSegmenter.segment(name), (s) => s.segment);
}

/* Longest "head…tail" that fits the wrapper, measured with canvas
   measureText against the wrapper's computed font. Graphemes, not code
   units — filenames here carry emoji and CJK, and a blind slice() can shear
   a surrogate pair. The context is owned by the calling instance: a shared
   module-global one can be left on a sibling row's font when a malformed
   shorthand assignment is silently rejected, mis-measuring this name. */
function fitMiddleTruncatedName(
    wrapper: HTMLElement,
    context: CanvasRenderingContext2D,
    name: string,
    graphemes: string[]
): string {
    const style = getComputedStyle(wrapper);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // 1px slack for subpixel rounding; the wrapper's overflow-hidden clips
    // any residue.
    const available = wrapper.clientWidth - 1;
    if (context.measureText(name).width <= available) return name;
    /* The tail may never eat more than half the width — at very narrow
       widths a full 12-grapheme tail leaves the head a single identifying
       character, and the head is what tells burst siblings apart. */
    const tailGraphemes = graphemes.slice(-NAME_TAIL_GRAPHEMES);
    while (
        tailGraphemes.length > 1 &&
        context.measureText(tailGraphemes.join('')).width > available / 2
    ) {
        tailGraphemes.shift();
    }
    const tail = tailGraphemes.join('');
    const headGraphemes = graphemes.slice(
        0,
        graphemes.length - tailGraphemes.length
    );
    let low = 0;
    let high = headGraphemes.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidate = headGraphemes.slice(0, mid).join('') + '…' + tail;
        if (context.measureText(candidate).width <= available) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return headGraphemes.slice(0, low).join('') + '…' + tail;
}

interface MiddleTruncateNameProps {
    name: string;
    className?: string;
}

/* Middle truncation for user-supplied filenames — use this, not
   `className="truncate"`: end-truncation makes burst siblings
   (_MG_4501.CR2 vs _MG_4524.CR2) indistinguishable and hides the extension.

   It has to be JS-measured: the CSS two-span trick leaves a hole at the
   seam, because text-overflow paints "…" after the last glyph that fully
   fits and the rest of the head's box stays blank. Rendering the fitted
   "head…tail" as one text run puts the ellipsis flush against the tail.
   The full name stays in the DOM (sr-only + title) for screen readers,
   hover, and the e2e specs that locate rows by full filename; the truncated
   copy is aria-hidden.

   The wrapper must get its width from the layout, not its content —
   a width-constrained ancestor (min-w-0 chain), or flex-1 when it sits in
   a flex row — so refitting can't ratchet the available width down. */
export function MiddleTruncateName({
    name,
    className,
}: MiddleTruncateNameProps) {
    const wrapperRef = useRef<HTMLSpanElement>(null);
    // One canvas context per instance — see fitMiddleTruncatedName. Lazily
    // created on first fit, reused across resizes (no per-tick allocation).
    const measureContextRef = useRef<CanvasRenderingContext2D | null>(null);
    const graphemes = useMemo(() => segmentGraphemes(name), [name]);
    const [display, setDisplay] = useState(name);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        measureContextRef.current ??= document
            .createElement('canvas')
            .getContext('2d');
        const context = measureContextRef.current;
        // No canvas support: leave the full name in place and let the CSS
        // text-ellipsis on the wrapper end-truncate it.
        if (!context) return;
        let isActive = true;
        const fit = () => {
            if (isActive) {
                setDisplay(
                    fitMiddleTruncatedName(wrapper, context, name, graphemes)
                );
            }
        };
        const observer = new ResizeObserver(fit);
        observer.observe(wrapper);
        fit();
        // A web-font swap changes glyph widths without resizing the wrapper.
        document.fonts.ready.then(fit, () => undefined);
        return () => {
            isActive = false;
            observer.disconnect();
        };
    }, [name, graphemes]);

    return (
        <span
            ref={wrapperRef}
            className={cn(
                // text-ellipsis so a long name still shows "…" via CSS before
                // the fit effect runs (SSR first paint, slow hydration, no JS);
                // once fitted, "head…tail" fits and the CSS ellipsis is inert.
                'block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap',
                className
            )}
            title={name}
        >
            <span className="sr-only">{name}</span>
            <span aria-hidden>{display}</span>
        </span>
    );
}

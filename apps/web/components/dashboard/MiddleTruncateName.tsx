'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/* Tail length for middle truncation. Burst shots share a prefix and differ
   only in the trailing digits, and the extension (.dng vs .jpg) is real
   information — so the end of the name must survive truncation, not the
   start. 12 graphemes covers "<counter>.<ext>". */
const NAME_TAIL_GRAPHEMES = 12;

let measureContext: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
    measureContext ??= document.createElement('canvas').getContext('2d');
    return measureContext;
}

/* Longest "head…tail" that fits the wrapper, measured with canvas
   measureText against the wrapper's computed font. Graphemes, not code
   units — filenames here carry emoji and CJK, and a blind slice() can shear
   a surrogate pair. */
function fitMiddleTruncatedName(wrapper: HTMLElement, name: string): string {
    const context = getMeasureContext();
    if (!context) return name;
    const style = getComputedStyle(wrapper);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // 1px slack for subpixel rounding; the wrapper's overflow-hidden clips
    // any residue.
    const available = wrapper.clientWidth - 1;
    if (context.measureText(name).width <= available) return name;
    const graphemes = Array.from(
        new Intl.Segmenter().segment(name),
        (segment) => segment.segment
    );
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
    const [display, setDisplay] = useState(name);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        let isActive = true;
        const fit = () => {
            if (isActive) {
                setDisplay(fitMiddleTruncatedName(wrapper, name));
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
    }, [name]);

    return (
        <span
            ref={wrapperRef}
            className={cn(
                'block min-w-0 overflow-hidden whitespace-nowrap',
                className
            )}
            title={name}
        >
            <span className="sr-only">{name}</span>
            <span aria-hidden>{display}</span>
        </span>
    );
}

/**
 * Motion primitives shared by the library's choreographies (batch open/close
 * in batchTransition.ts, the file viewer's expand/collapse in FileViewer).
 */

export const EASE = {
    emph: 'cubic-bezier(.2,0,0,1)',
    decel: 'cubic-bezier(0,0,.2,1)',
    accel: 'cubic-bezier(.3,0,.8,.15)',
    std: 'cubic-bezier(.4,0,.2,1)',
};

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function supportsLinearEasing(): boolean {
    try {
        return CSS.supports('transition-timing-function', 'linear(0, 1)');
    } catch {
        return false;
    }
}

// A damped spring from 0 to 1, sampled into a CSS linear() easing so WAAPI
// plays real physics.
export function spring(
    stiffness: number,
    damping: number,
    fallback = 'cubic-bezier(.34,1.25,.64,1)'
): { e: string; d: number } {
    const dt = 1 / 240;
    let x = 0;
    let v = 0;
    let t = 0;
    const points = [0];
    while (t < 2.5) {
        const a = -stiffness * (x - 1) - damping * v;
        v += a * dt;
        x += v * dt;
        t += dt;
        points.push(x);
        if (t > 0.2 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
    }
    const n = 48;
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
        out.push(+points[Math.round((i / n) * (points.length - 1))].toFixed(4));
    }
    out[0] = 0;
    out[n] = 1;
    return {
        e: supportsLinearEasing() ? `linear(${out.join(',')})` : fallback,
        d: Math.round(t * 1000),
    };
}

/**
 * Slow motion for reviewing the choreography, the motion study's "Slow
 * motion" toggle: `localStorage.setItem('nexus:slowmo', '4')` plays every
 * transition 4x slower.
 */
export function readSlowMotion(): number {
    try {
        const factor = Number(localStorage.getItem('nexus:slowmo'));
        return factor > 0 ? factor : 1;
    } catch {
        return 1;
    }
}

export function prefersReducedMotion(): boolean {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { DepthMarker } from './depth-marker';

// Marine snow: positions/timings are fixed (not random) so the server render
// is deterministic and hydration-safe.
const snowflakes = [
    { left: '6%', size: 3, duration: '16s', delay: '0s', opacity: 0.4 },
    { left: '15%', size: 2, duration: '22s', delay: '-8s', opacity: 0.3 },
    { left: '27%', size: 4, duration: '19s', delay: '-3s', opacity: 0.5 },
    { left: '38%', size: 2, duration: '25s', delay: '-14s', opacity: 0.25 },
    { left: '52%', size: 3, duration: '18s', delay: '-6s', opacity: 0.35 },
    { left: '63%', size: 2, duration: '23s', delay: '-11s', opacity: 0.3 },
    { left: '74%', size: 4, duration: '17s', delay: '-2s', opacity: 0.45 },
    { left: '85%', size: 2, duration: '21s', delay: '-9s', opacity: 0.3 },
    { left: '93%', size: 3, duration: '20s', delay: '-5s', opacity: 0.4 },
];

const tickerItems = [
    '11 nines durability',
    'AES-256 encryption',
    '12–48 h retrieval',
    '5 GB free forever',
];

const rise = 'animate-[landing-rise_0.9s_cubic-bezier(0.22,1,0.36,1)_both]';

export function Hero() {
    return (
        <section className="relative overflow-hidden pt-28 pb-24 md:pt-40 md:pb-36">
            <div aria-hidden className="absolute inset-0 -z-10">
                {snowflakes.map((flake) => (
                    <span
                        key={flake.left}
                        className="absolute top-0 rounded-full bg-(--foam)"
                        style={
                            {
                                left: flake.left,
                                width: flake.size,
                                height: flake.size,
                                animation: `landing-drift ${flake.duration} linear ${flake.delay} infinite`,
                                '--drift-opacity': flake.opacity,
                            } as CSSProperties
                        }
                    />
                ))}
            </div>
            <DepthRuler />
            <div className="mx-auto max-w-6xl px-6">
                <DepthMarker depth="0 m" name="Sea level" className={rise} />
                <h1
                    className={`mt-8 max-w-5xl font-display text-[clamp(3rem,9vw,7.5rem)] leading-[0.95] tracking-tight text-balance ${rise}`}
                    style={{ animationDelay: '120ms' }}
                >
                    The bottom of{' '}
                    <em className="font-display italic text-(--ice)">
                        the cloud.
                    </em>
                </h1>
                <p
                    className={`mt-8 max-w-xl text-lg leading-relaxed text-(--mist) md:text-xl ${rise}`}
                    style={{ animationDelay: '240ms' }}
                >
                    Nexus is deep storage for the work you can&apos;t lose —
                    twenty years of negatives, the client archive, every RAW
                    you&apos;ve ever shot. Archival-grade durability, up to 60%
                    cheaper than hot cloud storage.
                </p>
                <div
                    className={`mt-12 flex flex-col gap-4 sm:flex-row sm:items-center ${rise}`}
                    style={{ animationDelay: '360ms' }}
                >
                    <Link
                        href="/sign-up"
                        className="inline-flex items-center justify-center gap-3 bg-(--ice) px-8 py-4 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-(--ice-deep) transition hover:brightness-110 hover:shadow-[0_0_48px_oklch(0.87_0.095_210_/_0.35)]"
                    >
                        Start storing free
                        <span aria-hidden>↓</span>
                    </Link>
                    <Link
                        href="#how-it-works"
                        className="inline-flex items-center justify-center gap-3 border border-(--hairline) px-8 py-4 font-mono text-[13px] uppercase tracking-[0.2em] text-(--mist) transition-colors hover:border-(--ice) hover:text-(--ice)"
                    >
                        Descend to see how
                    </Link>
                </div>
                <ul
                    className={`mt-16 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.25em] text-(--faint) ${rise}`}
                    style={{ animationDelay: '480ms' }}
                >
                    {tickerItems.map((item) => (
                        <li key={item} className="flex items-center gap-3">
                            <span aria-hidden className="text-(--ice)">
                                ▪
                            </span>
                            {item}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

function DepthRuler() {
    const marks = ['0', '', '', '', '10', '', '', '', '20', '', '', '', '30'];
    return (
        <div
            aria-hidden
            className="absolute top-0 right-8 bottom-0 hidden flex-col items-end justify-between border-r border-(--hairline) pr-3 lg:flex"
        >
            {marks.map((mark, index) => (
                <div
                    key={index}
                    className="flex items-center gap-2 font-mono text-[10px] text-(--faint)"
                >
                    <span>{mark && `−${mark} m`}</span>
                    <span
                        className={`h-px bg-(--faint) ${mark ? 'w-4' : 'w-2'}`}
                    />
                </div>
            ))}
        </div>
    );
}

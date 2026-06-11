import Link from 'next/link';
import { DepthMarker } from './depth-marker';

export function CTA() {
    return (
        <section className="py-28 md:py-40">
            <div className="mx-auto max-w-6xl px-6 text-center">
                <DepthMarker
                    depth="−7,200 m"
                    name="The floor"
                    className="justify-center"
                />
                <h2 className="mx-auto mt-10 max-w-3xl font-display text-5xl leading-[1.02] tracking-tight text-balance md:text-7xl">
                    Nothing gets lost{' '}
                    <em className="italic text-(--ice)">down here.</em>
                </h2>
                <p className="mx-auto mt-8 max-w-md text-lg leading-relaxed text-(--mist)">
                    Put your life&apos;s work somewhere built to keep it. 5 GB
                    free forever — no credit card required.
                </p>
                <Link
                    href="/sign-up"
                    className="mt-12 inline-flex items-center gap-3 bg-(--ice) px-10 py-5 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-(--ice-deep) transition hover:brightness-110 hover:shadow-[0_0_64px_oklch(0.87_0.095_210_/_0.4)]"
                >
                    Send it down
                    <span aria-hidden>▽</span>
                </Link>
                <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.3em] text-(--faint)">
                    Retrieval anytime · 12–48 h to surface
                </p>
            </div>
        </section>
    );
}

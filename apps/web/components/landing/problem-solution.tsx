import { DepthMarker } from './depth-marker';

const failureModes = [
    {
        id: '01',
        title: 'The closet drive',
        detail: 'Spinning disks die in silence. Nobody checks until it matters.',
    },
    {
        id: '02',
        title: 'The hot-cloud bill',
        detail: 'Premium prices, every month, for files you open once a year.',
    },
    {
        id: '03',
        title: 'The DIY archive',
        detail: 'Glacier is cheap — if you speak lifecycle policies and egress math.',
    },
];

export function ProblemSolution() {
    return (
        <section className="border-y border-(--hairline) py-24 md:py-32">
            <div className="mx-auto max-w-6xl px-6">
                <DepthMarker depth="−650 m" name="The shallows" />
                <div className="mt-10 grid gap-14 lg:grid-cols-12">
                    <div className="lg:col-span-7">
                        <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-balance md:text-6xl">
                            Every photographer has a{' '}
                            <em className="italic text-(--ice)">near-miss</em>{' '}
                            story. A drive that almost didn&apos;t spin up.
                        </h2>
                        <p className="mt-8 max-w-lg text-lg leading-relaxed text-(--mist)">
                            Your life&apos;s work shouldn&apos;t live one power
                            surge from gone — and it shouldn&apos;t cost
                            hot-storage prices to keep cold. Nexus is the third
                            option: a place files go to be{' '}
                            <span className="text-(--foam)">kept</span>, not
                            browsed.
                        </p>
                    </div>
                    <div className="lg:col-span-5">
                        <p className="mb-6 font-mono text-[11px] uppercase tracking-[0.3em] text-(--faint)">
                            Known failure modes
                        </p>
                        <ul className="divide-y divide-(--hairline) border-y border-(--hairline)">
                            {failureModes.map((mode) => (
                                <li key={mode.id} className="flex gap-5 py-5">
                                    <span className="font-mono text-[11px] leading-6 text-(--ice)">
                                        {mode.id}
                                    </span>
                                    <div>
                                        <h3 className="text-base font-medium text-(--foam)">
                                            {mode.title}
                                        </h3>
                                        <p className="mt-1 text-sm leading-relaxed text-(--faint)">
                                            {mode.detail}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </section>
    );
}

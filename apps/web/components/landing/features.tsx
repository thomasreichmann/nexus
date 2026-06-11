import { DepthMarker } from './depth-marker';

const features = [
    {
        id: '01',
        title: 'Up to 60% cheaper',
        description:
            'Starting at $3/month for a full terabyte. Cold files at cold prices.',
    },
    {
        id: '02',
        title: '11 nines durability',
        description:
            "99.999999999% durability. Your files aren't going anywhere.",
    },
    {
        id: '03',
        title: '12–48 hour retrieval',
        description:
            'Request anything, anytime. It surfaces within hours, not weeks.',
    },
    {
        id: '04',
        title: 'End-to-end encryption',
        description:
            'Encrypted at rest and in transit. Always, with no setting to forget.',
    },
    {
        id: '05',
        title: 'No technical setup',
        description:
            'No lifecycle policies, no egress math. Upload, and we handle the rest.',
    },
    {
        id: '06',
        title: 'Human support',
        description: 'Real people who answer, ready when something matters.',
    },
];

export function Features() {
    return (
        <section
            id="features"
            className="scroll-mt-20 border-t border-(--hairline) py-24 md:py-32"
        >
            <div className="mx-auto max-w-6xl px-6">
                <DepthMarker depth="−3,200 m" name="The deep" />
                <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
                    <h2 className="font-display text-4xl tracking-tight md:text-5xl">
                        Built to keep,{' '}
                        <em className="italic text-(--ice)">not to browse.</em>
                    </h2>
                    <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-(--faint)">
                        The manifest
                    </p>
                </div>
                <ul className="mt-14 border-t border-(--hairline)">
                    {features.map((feature) => (
                        <li
                            key={feature.id}
                            className="group grid gap-2 border-b border-(--hairline) py-6 transition-colors hover:bg-(--foam)/3 md:grid-cols-12 md:items-baseline md:gap-6"
                        >
                            <span className="font-mono text-[11px] text-(--ice) md:col-span-1">
                                {feature.id}
                            </span>
                            <h3 className="text-xl font-medium text-(--foam) transition-transform duration-300 group-hover:translate-x-1 md:col-span-5 md:text-2xl">
                                {feature.title}
                            </h3>
                            <p className="leading-relaxed text-(--faint) transition-colors group-hover:text-(--mist) md:col-span-6">
                                {feature.description}
                            </p>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}

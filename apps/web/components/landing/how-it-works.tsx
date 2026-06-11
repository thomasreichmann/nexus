import { DepthMarker } from './depth-marker';

const steps = [
    {
        id: '01',
        title: 'Drop',
        description:
            'Drag in anything — any file type, any size, straight from the browser. No clients, no command line.',
    },
    {
        id: '02',
        title: 'Descend',
        description:
            'We sink your files through storage tiers into archival cold storage. Eleven nines of durability, encrypted the whole way down.',
    },
    {
        id: '03',
        title: 'Surface',
        description:
            'Ask for anything back, anytime. Your files rise to meet you within 12–48 hours.',
    },
];

export function HowItWorks() {
    return (
        <section id="how-it-works" className="scroll-mt-20 py-24 md:py-32">
            <div className="mx-auto max-w-6xl px-6">
                <DepthMarker depth="−1,800 m" name="Midwater" />
                <h2 className="mt-8 font-display text-4xl tracking-tight md:text-5xl">
                    Three moves. That&apos;s the whole product.
                </h2>
                <div className="mt-16 max-w-3xl">
                    <ol className="relative border-l border-(--hairline) pl-10 md:pl-14">
                        {steps.map((step, index) => (
                            <li
                                key={step.id}
                                className={`group relative ${
                                    index < steps.length - 1 ? 'pb-16' : ''
                                }`}
                            >
                                <span
                                    aria-hidden
                                    className="absolute top-1.5 -left-10 h-px w-6 bg-(--hairline) transition-colors group-hover:bg-(--ice) md:-left-14 md:w-9"
                                />
                                <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-(--ice)">
                                    {step.id}
                                </span>
                                <h3 className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
                                    {step.title}
                                </h3>
                                <p className="mt-3 max-w-md leading-relaxed text-(--mist)">
                                    {step.description}
                                </p>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </section>
    );
}

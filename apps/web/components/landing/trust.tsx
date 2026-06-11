import { DepthMarker } from './depth-marker';

const ledger = [
    {
        value: '99.999999999%',
        label: 'Designed durability — eleven nines',
    },
    {
        value: '12–48 h',
        label: 'From request to retrieval, any file',
    },
    {
        value: 'AES-256',
        label: 'Encryption at rest and in transit',
    },
];

export function Trust() {
    return (
        <section className="border-t border-(--hairline) py-20 md:py-24">
            <div className="mx-auto max-w-6xl px-6">
                <DepthMarker depth="−5,900 m" name="The trench" />
                <dl className="mt-12 grid gap-12 md:grid-cols-3 md:gap-8">
                    {ledger.map((entry) => (
                        <div key={entry.value}>
                            <dt className="order-last mt-3 font-mono text-[11px] uppercase tracking-[0.25em] text-(--faint)">
                                {entry.label}
                            </dt>
                            <dd className="font-display text-4xl tracking-tight text-(--ice) md:text-5xl">
                                {entry.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    );
}

import { Cloud, Terminal, Archive } from 'lucide-react';

const options = [
    {
        icon: Cloud,
        name: 'Consumer cloud',
        price: '$5–6 /TB/mo',
        detail: 'Instant access to every file, at a premium — whether you open it daily or once a year.',
        isHighlighted: false,
    },
    {
        icon: Terminal,
        name: 'Raw AWS Glacier',
        price: '~$1 /TB/mo',
        detail: 'The cheapest storage on earth, if you bring an AWS account, an SDK, and lifecycle policies.',
        isHighlighted: false,
    },
    {
        icon: Archive,
        name: 'Nexus',
        price: 'from $2 /TB/mo',
        detail: 'Glacier prices with a drag-and-drop interface. The tradeoff: retrieval takes hours, not seconds.',
        isHighlighted: true,
    },
];

export function Comparison() {
    return (
        <section className="border-t border-border bg-muted/30 py-16">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-4xl">
                    <div className="mb-12 text-center">
                        <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
                            The honest tradeoff
                        </h2>
                        <p className="text-lg text-muted-foreground text-balance">
                            If you open your files every day, keep your current
                            cloud. If you open them twice a year, stop paying
                            instant-access prices for them.
                        </p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3">
                        {options.map((option) => (
                            <div
                                key={option.name}
                                className={`rounded-xl border bg-card p-6 shadow-sm ${
                                    option.isHighlighted
                                        ? 'border-primary shadow-md'
                                        : 'border-border'
                                }`}
                            >
                                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <option.icon className="h-6 w-6 text-primary" />
                                </div>
                                <h3 className="mb-1 text-lg font-semibold">
                                    {option.name}
                                </h3>
                                <div className="mb-3 text-2xl font-bold">
                                    {option.price}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    {option.detail}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

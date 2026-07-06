import { Shield, Wallet, Clock, Lock, Globe, Download } from 'lucide-react';

const features = [
    {
        icon: Wallet,
        title: 'Up to 60% cheaper',
        description:
            'Starting at $3/month for 1 TB. Archival prices without the archival complexity.',
    },
    {
        icon: Shield,
        title: '11 nines durability',
        description:
            'Files live on AWS S3 Glacier Deep Archive, designed for 99.999999999% durability.',
    },
    {
        icon: Clock,
        title: 'Retrieval within 12 hours',
        description:
            'Request files anytime. Archived files are ready within 12 hours; recent uploads in minutes.',
    },
    {
        icon: Download,
        title: 'Unlimited retrievals',
        description:
            'Retrieval is baked into the price. No egress bills, no per-GB surprises.',
    },
    {
        icon: Globe,
        title: 'No technical setup',
        description:
            'No AWS account, no lifecycle policies, no SDK. Upload, and we handle the rest.',
    },
    {
        icon: Lock,
        title: 'Private by default',
        description:
            'Files are reachable only through your account, via time-limited signed download links.',
    },
];

export function Features() {
    return (
        <section
            id="features"
            className="border-t border-border bg-muted/30 py-20 md:py-28"
        >
            <div className="container mx-auto px-4">
                <div className="mx-auto mb-16 max-w-2xl text-center">
                    <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
                        Everything you need
                    </h2>
                    <p className="text-lg text-muted-foreground">
                        Serious archival storage, made simple.
                    </p>
                </div>
                <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2 lg:grid-cols-3">
                    {features.map((feature) => (
                        <div
                            key={feature.title}
                            className="rounded-xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
                        >
                            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                <feature.icon className="h-6 w-6 text-primary" />
                            </div>
                            <h3 className="mb-2 text-lg font-semibold">
                                {feature.title}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

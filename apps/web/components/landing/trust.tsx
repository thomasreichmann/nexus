import { Archive, Users, HardDrive } from 'lucide-react';

const stats = [
    {
        icon: Users,
        value: '10,000+',
        label: 'Active users',
    },
    {
        icon: HardDrive,
        value: '50+ PB',
        label: 'Data stored',
    },
    {
        icon: Archive,
        value: '99.99%',
        label: 'Uptime',
    },
];

export function Trust() {
    return (
        <section className="border-t border-border bg-muted/30 py-16">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-4xl">
                    <div className="mb-12 text-center">
                        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            Trusted by thousands
                        </p>
                    </div>
                    <div className="grid gap-8 md:grid-cols-3">
                        {stats.map((stat) => (
                            <div key={stat.label} className="text-center">
                                <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                    <stat.icon className="h-6 w-6 text-primary" />
                                </div>
                                <div className="text-3xl font-bold">
                                    {stat.value}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {stat.label}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

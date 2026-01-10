import { Upload, Database, Download } from 'lucide-react';

const steps = [
    {
        icon: Upload,
        title: 'Upload',
        description:
            'Drag and drop your files. We accept any file type, any size.',
    },
    {
        icon: Database,
        title: 'We archive',
        description:
            'Your files are automatically stored in cold storage with 11 nines durability.',
    },
    {
        icon: Download,
        title: 'Retrieve',
        description: "Request your files anytime. They're ready in 3-12 hours.",
    },
];

export function HowItWorks() {
    return (
        <section id="how-it-works" className="py-20 md:py-28">
            <div className="container mx-auto px-4">
                <div className="mx-auto mb-16 max-w-2xl text-center">
                    <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
                        How it works
                    </h2>
                    <p className="text-lg text-muted-foreground">
                        Three simple steps to secure, affordable storage.
                    </p>
                </div>
                <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-3">
                    {steps.map((step, index) => (
                        <div key={step.title} className="relative text-center">
                            <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                                <step.icon className="h-8 w-8 text-primary" />
                            </div>
                            <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                                {index + 1}
                            </div>
                            <h3 className="mb-2 text-xl font-semibold">
                                {step.title}
                            </h3>
                            <p className="text-muted-foreground">
                                {step.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

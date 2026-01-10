import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Shield, Zap, DollarSign } from 'lucide-react';

export function Hero() {
    return (
        <section className="relative overflow-hidden py-24 md:py-32">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-3xl text-center">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
                        </span>
                        Now with faster retrieval times
                    </div>
                    <h1 className="mb-6 text-4xl font-bold tracking-tight text-balance md:text-5xl lg:text-6xl">
                        Store everything.
                        <br />
                        <span className="text-primary">
                            Pay almost nothing.
                        </span>
                    </h1>
                    <p className="mb-10 text-lg text-muted-foreground text-balance md:text-xl">
                        Nexus is deep storage that just works. Get the
                        reliability of AWS Glacier without the complexity — for
                        just $1/TB/month.
                    </p>
                    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link href="/sign-up" className="w-full sm:w-auto">
                            <Button size="lg" className="w-full">
                                Start storing free
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                        <Link href="#how-it-works" className="w-full sm:w-auto">
                            <Button
                                variant="outline"
                                size="lg"
                                className="w-full bg-transparent"
                            >
                                See how it works
                            </Button>
                        </Link>
                    </div>
                    <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-primary" />
                            <span>90% cheaper than Dropbox</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-primary" />
                            <span>11 nines durability</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-primary" />
                            <span>No AWS expertise needed</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="absolute inset-0 -z-10 h-full w-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
        </section>
    );
}

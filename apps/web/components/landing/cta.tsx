import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function CTA() {
    return (
        <section className="py-20 md:py-28">
            <div className="container mx-auto px-4">
                <div className="mx-auto max-w-3xl text-center">
                    <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl text-balance">
                        Your archive deserves better than a drive in a closet.
                    </h2>
                    <p className="mb-8 text-lg text-muted-foreground">
                        Every plan starts with a 30-day free trial — full
                        features, no commitment.
                    </p>
                    <Link href="/sign-up">
                        <Button size="lg">
                            Start storing free
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                    <p className="mt-4 text-sm text-muted-foreground">
                        No credit card required.
                    </p>
                </div>
            </div>
        </section>
    );
}

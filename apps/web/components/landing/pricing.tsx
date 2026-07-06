import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { GITHUB_ISSUES_URL } from './links';

const plans = [
    {
        name: 'Starter',
        price: '$3',
        period: '/month',
        perTB: '$3.00 per TB',
        description: 'Perfect for personal archives',
        features: [
            '1 TB storage',
            'Unlimited uploads & retrievals',
            'Files ready within 12 hours',
            '30-day free trial',
        ],
        cta: 'Start free trial',
        popular: false,
    },
    {
        name: 'Pro',
        price: '$12',
        period: '/month',
        perTB: '$2.40 per TB',
        description: 'For photographers & creators',
        features: [
            '5 TB storage',
            'Unlimited uploads & retrievals',
            'Files ready within 12 hours',
            '30-day free trial',
        ],
        cta: 'Start free trial',
        popular: true,
    },
    {
        name: 'Max',
        price: '$20',
        period: '/month',
        perTB: '$2.00 per TB',
        description: 'For serious archivists',
        features: [
            '10 TB storage',
            'Unlimited uploads & retrievals',
            'Files ready within 12 hours',
            '30-day free trial',
        ],
        cta: 'Start free trial',
        popular: false,
    },
];

export function Pricing() {
    return (
        <section id="pricing" className="py-20 md:py-28">
            <div className="container mx-auto px-4">
                <div className="mx-auto mb-16 max-w-2xl text-center">
                    <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
                        Simple, transparent pricing
                    </h2>
                    <p className="text-lg text-muted-foreground">
                        Three tiers, one variable: how much you store. Retrieval
                        is always included.
                    </p>
                </div>
                <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative flex flex-col rounded-xl border bg-card p-8 shadow-sm ${
                                plan.popular
                                    ? 'border-primary shadow-md'
                                    : 'border-border'
                            }`}
                        >
                            {plan.popular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                                    Best value for most
                                </div>
                            )}
                            <div className="mb-6">
                                <h3 className="mb-1 text-lg font-semibold">
                                    {plan.name}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {plan.description}
                                </p>
                            </div>
                            <div className="mb-6">
                                <span className="text-4xl font-bold">
                                    {plan.price}
                                </span>
                                <span className="text-muted-foreground">
                                    {plan.period}
                                </span>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {plan.perTB}
                                </p>
                            </div>
                            <ul className="mb-8 space-y-3">
                                {plan.features.map((feature) => (
                                    <li
                                        key={feature}
                                        className="flex items-center gap-3 text-sm"
                                    >
                                        <Check className="h-4 w-4 text-primary" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                            <Link href="/sign-up" className="mt-auto w-full">
                                <Button
                                    className="w-full"
                                    variant={
                                        plan.popular ? 'default' : 'outline'
                                    }
                                >
                                    {plan.cta}
                                </Button>
                            </Link>
                        </div>
                    ))}
                </div>
                <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
                    Pay yearly and get two months free — $30, $120, or $200 per
                    year. Storing more than 10 TB?{' '}
                    <a
                        href={GITHUB_ISSUES_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4 hover:text-foreground transition-colors"
                    >
                        Get in touch
                    </a>{' '}
                    and we&apos;ll set up a custom plan.
                </p>
            </div>
        </section>
    );
}

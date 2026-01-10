import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

const plans = [
    {
        name: 'Starter',
        storage: '100 GB',
        price: '$2',
        period: '/month',
        description: 'Perfect for personal archives',
        features: [
            '100 GB storage',
            'Unlimited uploads',
            '3-12 hour retrieval',
            'End-to-end encryption',
            'Email support',
        ],
        cta: 'Get started',
        popular: false,
    },
    {
        name: 'Pro',
        storage: '1 TB',
        price: '$9',
        period: '/month',
        description: 'For photographers & creators',
        features: [
            '1 TB storage',
            'Unlimited uploads',
            '3-12 hour retrieval',
            'End-to-end encryption',
            'Priority support',
            'Bulk operations',
        ],
        cta: 'Get started',
        popular: true,
    },
    {
        name: 'Business',
        storage: '5 TB',
        price: '$39',
        period: '/month',
        description: 'For teams with compliance needs',
        features: [
            '5 TB storage',
            'Unlimited uploads',
            'Faster retrieval options',
            'End-to-end encryption',
            'Dedicated support',
            'Team management',
            'Audit logs',
        ],
        cta: 'Contact sales',
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
                        No hidden fees. No surprises. Just affordable archival
                        storage.
                    </p>
                </div>
                <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative rounded-xl border bg-card p-8 shadow-sm ${
                                plan.popular
                                    ? 'border-primary shadow-md'
                                    : 'border-border'
                            }`}
                        >
                            {plan.popular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                                    Most popular
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
                            <Link href="/sign-up" className="w-full">
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
            </div>
        </section>
    );
}

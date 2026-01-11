import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

const plans = [
    {
        name: 'Starter',
        storage: '1 TB',
        price: '$3',
        period: '/month',
        description: 'Perfect for personal archives',
        features: [
            '1 TB storage',
            'Unlimited uploads',
            '12-48 hour retrieval',
            'End-to-end encryption',
            'Email support',
        ],
        cta: 'Start free trial',
        popular: false,
    },
    {
        name: 'Pro',
        storage: '5 TB',
        price: '$12',
        period: '/month',
        description: 'For photographers & creators',
        features: [
            '5 TB storage',
            'Unlimited uploads',
            '12-48 hour retrieval',
            'End-to-end encryption',
            'Priority support',
        ],
        cta: 'Start free trial',
        popular: true,
    },
    {
        name: 'Max',
        storage: '10 TB',
        price: '$20',
        period: '/month',
        description: 'For serious archivists',
        features: [
            '10 TB storage',
            'Unlimited uploads',
            '12-48 hour retrieval',
            'End-to-end encryption',
            'Priority support',
        ],
        cta: 'Start free trial',
        popular: false,
    },
    {
        name: 'Enterprise',
        storage: 'Custom',
        price: 'Custom',
        period: '',
        description: 'For teams with compliance needs',
        features: [
            'Custom storage (20TB+)',
            'SSO / SAML',
            'Audit logs',
            'Dedicated support',
            'SLA guarantees',
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
                <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-4">
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

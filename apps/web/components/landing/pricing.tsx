import Link from 'next/link';
import { DepthMarker } from './depth-marker';

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
        <section id="pricing" className="scroll-mt-20 py-24 md:py-32">
            <div className="mx-auto max-w-6xl px-6">
                <DepthMarker depth="−4,800 m" name="Abyssal plain" />
                <h2 className="mt-8 font-display text-4xl tracking-tight md:text-5xl">
                    Pressure-tested pricing.
                </h2>
                <p className="mt-4 max-w-md text-lg leading-relaxed text-(--mist)">
                    No hidden fees. No egress surprises. Storage that costs what
                    cold storage should.
                </p>
                <div className="mt-14 grid gap-px border border-(--hairline) bg-(--hairline) md:grid-cols-2 lg:grid-cols-4">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative flex flex-col p-8 ${
                                plan.popular
                                    ? 'bg-(--foam)/6'
                                    : 'bg-(--abyss)/40'
                            }`}
                        >
                            {plan.popular && (
                                <span className="absolute top-0 right-8 -translate-y-1/2 bg-(--ice) px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-(--ice-deep)">
                                    Most chosen
                                </span>
                            )}
                            <h3 className="font-mono text-[11px] uppercase tracking-[0.3em] text-(--ice)">
                                {plan.name}
                            </h3>
                            <p className="mt-2 text-sm text-(--faint)">
                                {plan.description}
                            </p>
                            <div className="mt-6 flex items-baseline gap-1">
                                <span className="font-display text-5xl tracking-tight text-(--foam)">
                                    {plan.price}
                                </span>
                                <span className="text-sm text-(--faint)">
                                    {plan.period}
                                </span>
                            </div>
                            <ul className="mt-8 mb-10 space-y-3">
                                {plan.features.map((feature) => (
                                    <li
                                        key={feature}
                                        className="flex items-start gap-3 text-sm text-(--mist)"
                                    >
                                        <span
                                            aria-hidden
                                            className="mt-0.5 text-(--ice)"
                                        >
                                            ▪
                                        </span>
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                            <Link
                                href="/sign-up"
                                className={`mt-auto inline-flex justify-center px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                                    plan.popular
                                        ? 'bg-(--ice) text-(--ice-deep) hover:brightness-110'
                                        : 'border border-(--hairline) text-(--mist) hover:border-(--ice) hover:text-(--ice)'
                                }`}
                            >
                                {plan.cta}
                            </Link>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

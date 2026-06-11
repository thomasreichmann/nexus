import Link from 'next/link';
import { Logo } from './Logo';

const footerLinks = {
    product: [
        { label: 'Features', href: '#features' },
        { label: 'Pricing', href: '#pricing' },
        { label: 'Security', href: '#' },
        { label: 'Roadmap', href: '#' },
    ],
    company: [
        { label: 'About', href: '#' },
        { label: 'Blog', href: '#' },
        { label: 'Careers', href: '#' },
        { label: 'Contact', href: '#' },
    ],
    resources: [
        { label: 'Documentation', href: '#' },
        { label: 'Help Center', href: '#' },
        { label: 'API Reference', href: '#' },
        { label: 'Status', href: '#' },
    ],
    legal: [
        { label: 'Privacy', href: '#' },
        { label: 'Terms', href: '#' },
        { label: 'DPA', href: '#' },
    ],
};

const columns = [
    { title: 'Product', links: footerLinks.product },
    { title: 'Company', links: footerLinks.company },
    { title: 'Resources', links: footerLinks.resources },
    { title: 'Legal', links: footerLinks.legal },
];

export function Footer() {
    return (
        <footer className="border-t border-(--hairline) py-16">
            <div className="mx-auto max-w-6xl px-6">
                <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-6">
                    <div className="lg:col-span-2">
                        <Logo className="mb-5" />
                        <p className="max-w-xs text-sm leading-relaxed text-(--faint)">
                            Deep storage made simple. Store your files forever
                            for almost nothing.
                        </p>
                    </div>
                    {columns.map((column) => (
                        <div key={column.title}>
                            <h4 className="mb-5 font-mono text-[11px] uppercase tracking-[0.3em] text-(--mist)">
                                {column.title}
                            </h4>
                            <ul className="space-y-3">
                                {column.links.map((link) => (
                                    <li key={link.label}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-(--faint) transition-colors hover:text-(--ice)"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-(--hairline) pt-8 font-mono text-[11px] uppercase tracking-[0.25em] text-(--faint)">
                    <p>&copy; {new Date().getFullYear()} Nexus</p>
                    <p aria-hidden>All depths reserved ▽</p>
                </div>
            </div>
        </footer>
    );
}

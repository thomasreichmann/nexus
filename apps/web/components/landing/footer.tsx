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

export function Footer() {
    return (
        <footer className="border-t border-border bg-muted/30 py-12">
            <div className="container mx-auto px-4">
                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-6">
                    <div className="lg:col-span-2">
                        <Logo className="mb-4" />
                        <p className="text-sm text-muted-foreground">
                            Deep storage made simple. Store your files forever
                            for almost nothing.
                        </p>
                    </div>
                    <div>
                        <h4 className="mb-4 text-sm font-semibold">Product</h4>
                        <ul className="space-y-2">
                            {footerLinks.product.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h4 className="mb-4 text-sm font-semibold">Company</h4>
                        <ul className="space-y-2">
                            {footerLinks.company.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h4 className="mb-4 text-sm font-semibold">
                            Resources
                        </h4>
                        <ul className="space-y-2">
                            {footerLinks.resources.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h4 className="mb-4 text-sm font-semibold">Legal</h4>
                        <ul className="space-y-2">
                            {footerLinks.legal.map((link) => (
                                <li key={link.label}>
                                    <Link
                                        href={link.href}
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="mt-12 border-t border-border pt-8 text-center text-sm text-muted-foreground">
                    <p>
                        &copy; {new Date().getFullYear()} Nexus. All rights
                        reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}

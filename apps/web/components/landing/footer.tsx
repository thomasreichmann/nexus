import Link from 'next/link';
import { Logo } from './Logo';
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL } from './links';

const productLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'How it works', href: '#how-it-works' },
];

const accountLinks = [
    { label: 'Sign in', href: '/sign-in' },
    { label: 'Create account', href: '/sign-up' },
];

const projectLinks = [
    { label: 'GitHub', href: GITHUB_REPO_URL },
    { label: 'Issues & roadmap', href: GITHUB_ISSUES_URL },
];

export function Footer() {
    return (
        <footer className="border-t border-border bg-muted/30 py-12">
            <div className="container mx-auto px-4">
                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
                    <div className="lg:col-span-2">
                        <Logo className="mb-4" />
                        <p className="text-sm text-muted-foreground">
                            Deep storage made simple. Keep everything, pay
                            almost nothing.
                        </p>
                    </div>
                    <div>
                        <h4 className="mb-4 text-sm font-semibold">Product</h4>
                        <ul className="space-y-2">
                            {productLinks.map((link) => (
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
                        <h4 className="mb-4 text-sm font-semibold">Account</h4>
                        <ul className="space-y-2">
                            {accountLinks.map((link) => (
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
                        <h4 className="mb-4 text-sm font-semibold">Project</h4>
                        <ul className="space-y-2">
                            {projectLinks.map((link) => (
                                <li key={link.label}>
                                    <a
                                        href={link.href}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {link.label}
                                    </a>
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

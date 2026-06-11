import Link from 'next/link';
import { Logo } from './Logo';

const navLinks = [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
];

export function Header() {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-(--hairline) bg-(--surface)/75 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
                <Logo />
                <nav className="hidden items-center gap-8 md:flex">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="font-mono text-[11px] uppercase tracking-[0.2em] text-(--mist) transition-colors hover:text-(--ice)"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>
                <div className="flex items-center gap-2">
                    <Link
                        href="/sign-in"
                        className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-(--mist) transition-colors hover:text-(--foam)"
                    >
                        Sign in
                    </Link>
                    <Link
                        href="/sign-up"
                        className="border border-(--ice) px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-(--ice) transition-colors hover:bg-(--ice) hover:text-(--ice-deep)"
                    >
                        Start storing
                    </Link>
                </div>
            </div>
        </header>
    );
}

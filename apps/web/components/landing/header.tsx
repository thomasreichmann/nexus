import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Archive } from 'lucide-react';

export function Header() {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <Link href="/" className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                        <Archive className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <span className="text-xl font-semibold">Nexus</span>
                </Link>
                <nav className="hidden md:flex items-center gap-8">
                    <Link
                        href="#features"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Features
                    </Link>
                    <Link
                        href="#pricing"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Pricing
                    </Link>
                    <Link
                        href="#how-it-works"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        How it works
                    </Link>
                </nav>
                <div className="flex items-center gap-3">
                    <Link href="/sign-in">
                        <Button variant="ghost">Sign in</Button>
                    </Link>
                    <Link href="/sign-up">
                        <Button>Start storing</Button>
                    </Link>
                </div>
            </div>
        </header>
    );
}

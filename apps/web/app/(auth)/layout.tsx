import { Archive } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col">
            <header className="flex h-16 items-center px-4">
                <Link href="/" className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                        <Archive className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <span className="text-xl font-semibold">Nexus</span>
                </Link>
            </header>
            <main className="flex flex-1 items-center justify-center px-4 py-12">
                {children}
            </main>
        </div>
    );
}

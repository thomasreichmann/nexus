import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/landing/Logo';

/**
 * Frame for the public share pages: the uploader at `/share` and a link's
 * files at `/s/<id>`. Most people who land here have never heard of Nexus, so
 * the chrome stays out of the way and says what the product is once, at the
 * bottom.
 */
export default function ShareLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col">
            <header className="flex h-16 items-center justify-between px-4">
                <Logo />
                <Link
                    href="/share"
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    Share files
                </Link>
            </header>
            <main className="flex flex-1 justify-center px-4 py-10 sm:py-16">
                {/* min-w-0: a flex child won't shrink below a long unbreakable
                    filename without it (#311). */}
                <div className="w-full min-w-0 max-w-xl">{children}</div>
            </main>
            <footer className="px-4 py-6 text-center text-sm text-muted-foreground">
                Sent with{' '}
                <Link
                    href="/"
                    className="font-medium text-foreground hover:underline"
                >
                    Nexus
                </Link>
                , archival storage for the files you keep.
            </footer>
        </div>
    );
}

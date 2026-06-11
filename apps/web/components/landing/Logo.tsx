import Link from 'next/link';
import { cn } from '@/lib/cn';

interface LogoProps {
    className?: string;
}

export function Logo({ className }: LogoProps) {
    return (
        <Link
            href="/"
            className={cn('group flex items-baseline gap-2.5', className)}
        >
            <span
                aria-hidden
                className="flex h-7 w-7 translate-y-0.5 items-center justify-center border border-(--ice) font-mono text-[13px] leading-none text-(--ice) transition-colors group-hover:bg-(--ice) group-hover:text-(--ice-deep)"
            >
                ▽
            </span>
            <span className="font-display text-2xl tracking-tight text-(--foam)">
                Nexus
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-(--faint) sm:inline">
                Deep storage
            </span>
        </Link>
    );
}

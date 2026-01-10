import Link from 'next/link';
import { Archive } from 'lucide-react';
import { cn } from '@/lib/cn';

interface LogoProps {
    className?: string;
}

export function Logo({ className }: LogoProps) {
    return (
        <Link href="/" className={cn('flex items-center gap-2', className)}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Archive className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">Nexus</span>
        </Link>
    );
}

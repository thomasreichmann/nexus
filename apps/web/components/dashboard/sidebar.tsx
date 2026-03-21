'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { getNavItems } from '@/lib/dashboard/navigation';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { Archive } from 'lucide-react';

export function DashboardSidebar() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const navItems = getNavItems(session?.user?.role);
    const trpc = useTRPC();
    const { data: usage } = useQuery(trpc.storage.getUsage.queryOptions());

    return (
        <aside className="hidden w-64 flex-col border-r border-border bg-sidebar md:flex">
            <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                    <Archive className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="text-xl font-semibold">Nexus</span>
            </div>
            <nav className="flex-1 p-4">
                <ul className="space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <li key={item.name}>
                                <Link
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                        isActive
                                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
                                    )}
                                >
                                    <item.icon className="h-5 w-5" />
                                    {item.name}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
            <div className="border-t border-sidebar-border p-4">
                <div className="rounded-lg bg-sidebar-accent/50 p-4">
                    <p className="text-xs font-medium text-sidebar-foreground">
                        Storage used
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-sidebar-border">
                        <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                                width: `${usage?.percentage ?? 0}%`,
                            }}
                        />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {usage
                            ? `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)}`
                            : 'Loading...'}
                    </p>
                </div>
            </div>
        </aside>
    );
}

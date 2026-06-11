'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { getNavItems } from '@/lib/dashboard/navigation';
import { formatBytes } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';

export function DashboardSidebar() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const navItems = getNavItems(session?.user?.role);
    const trpc = useTRPC();
    const { data: usage } = useQuery(trpc.storage.getUsage.queryOptions());

    return (
        <aside className="hidden w-64 flex-col border-r border-(--hairline) bg-sidebar md:flex">
            <div className="flex h-16 items-center gap-2.5 border-b border-(--hairline) px-6">
                <span
                    aria-hidden
                    className="flex h-7 w-7 items-center justify-center border border-(--ice) font-mono text-[13px] leading-none text-(--ice)"
                >
                    ▽
                </span>
                <span className="font-display text-2xl tracking-tight text-(--foam)">
                    Nexus
                </span>
            </div>
            <nav className="flex-1 overflow-y-auto p-4">
                <ul className="space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <li key={item.name}>
                                <Link
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-3 border-l-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors',
                                        isActive
                                            ? 'border-(--ice) bg-sidebar-accent text-(--ice)'
                                            : 'border-transparent text-(--faint) hover:bg-sidebar-accent/50 hover:text-(--mist)'
                                    )}
                                >
                                    <item.icon
                                        className="h-4 w-4"
                                        strokeWidth={1.5}
                                    />
                                    {item.name}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
            <div className="border-t border-(--hairline) p-4">
                <div className="border border-(--hairline) p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-(--faint)">
                        Hold capacity
                    </p>
                    <div className="mt-3 h-1.5 overflow-hidden bg-(--hairline)">
                        <div
                            className="h-full bg-(--ice) transition-all"
                            style={{
                                width: `${usage?.percentage ?? 0}%`,
                            }}
                        />
                    </div>
                    <p className="mt-2.5 font-mono text-[11px] tabular-nums text-(--mist)">
                        {usage
                            ? `${formatBytes(usage.usedBytes)} / ${formatBytes(usage.quotaBytes)}`
                            : 'Sounding…'}
                    </p>
                </div>
            </div>
        </aside>
    );
}

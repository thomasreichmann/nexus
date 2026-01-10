'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { dashboardNavigation } from '@/lib/dashboard/navigation';
import { Archive } from 'lucide-react';

export function DashboardSidebar() {
    const pathname = usePathname();

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
                    {dashboardNavigation.map((item) => {
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
                        <div className="h-full w-1/3 rounded-full bg-primary" />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        34.2 GB of 100 GB
                    </p>
                </div>
            </div>
        </aside>
    );
}

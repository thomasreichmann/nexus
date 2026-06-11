'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPositioner,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { signOut, useSession } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { getNavItems } from '@/lib/dashboard/navigation';
import { LogOut, Menu, Settings, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

export function DashboardHeader() {
    const pathname = usePathname();
    const router = useRouter();
    const { data: session } = useSession();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const navItems = getNavItems(session?.user?.role);

    async function handleSignOut() {
        await signOut();
        router.push('/');
    }

    return (
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-(--hairline) bg-(--background) px-4 md:px-6">
            <div className="flex items-center gap-4 md:hidden">
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <SheetTrigger
                        render={<Button variant="ghost" size="icon" />}
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle menu</span>
                    </SheetTrigger>
                    <SheetContent side="left" className="descent w-64 p-0">
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
                        <nav className="p-4">
                            <ul className="space-y-1">
                                {navItems.map((item) => {
                                    const isActive = pathname === item.href;
                                    return (
                                        <li key={item.name}>
                                            <Link
                                                href={item.href}
                                                onClick={() =>
                                                    setMobileMenuOpen(false)
                                                }
                                                className={cn(
                                                    'flex items-center gap-3 border-l-2 px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors',
                                                    isActive
                                                        ? 'border-(--ice) bg-accent text-(--ice)'
                                                        : 'border-transparent text-(--faint) hover:bg-accent/50 hover:text-(--mist)'
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
                    </SheetContent>
                </Sheet>
            </div>
            <p
                aria-hidden
                className="hidden font-mono text-[10px] uppercase tracking-[0.35em] text-(--faint) md:block"
            >
                Vault control
            </p>

            <div className="flex items-center">
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" />}
                    >
                        <div className="flex h-8 w-8 items-center justify-center border border-(--hairline)">
                            <User className="h-4 w-4 text-(--ice)" />
                        </div>
                        <span className="sr-only">User menu</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuPositioner align="end">
                        <DropdownMenuContent className="descent w-56">
                            <div className="px-2 py-1.5">
                                <p className="text-sm font-medium">
                                    {session?.user?.name ?? 'User'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {session?.user?.email ?? ''}
                                </p>
                            </div>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                render={<Link href="/dashboard/settings" />}
                            >
                                <Settings className="mr-2 h-4 w-4" />
                                Settings
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleSignOut}>
                                <LogOut className="mr-2 h-4 w-4" />
                                Sign out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenuPositioner>
                </DropdownMenu>
            </div>
        </header>
    );
}

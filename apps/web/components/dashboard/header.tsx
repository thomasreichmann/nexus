'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPositioner,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { dashboardNavigation } from '@/lib/dashboard/navigation';
import { Archive, LogOut, Menu, Settings, Upload, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export function DashboardHeader() {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background px-4 md:px-6">
            <div className="flex items-center gap-4 md:hidden">
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <SheetTrigger
                        render={<Button variant="ghost" size="icon" />}
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle menu</span>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-64 p-0">
                        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                                <Archive className="h-4 w-4 text-primary-foreground" />
                            </div>
                            <span className="text-xl font-semibold">Nexus</span>
                        </div>
                        <nav className="p-4">
                            <ul className="space-y-1">
                                {dashboardNavigation.map((item) => {
                                    const isActive = pathname === item.href;
                                    return (
                                        <li key={item.name}>
                                            <Link
                                                href={item.href}
                                                onClick={() =>
                                                    setMobileMenuOpen(false)
                                                }
                                                className={cn(
                                                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                                    isActive
                                                        ? 'bg-accent text-accent-foreground'
                                                        : 'text-foreground hover:bg-accent/50'
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
                    </SheetContent>
                </Sheet>
            </div>

            <div className="hidden md:block" />

            <div className="flex items-center gap-3">
                <Link
                    href="/dashboard/upload"
                    className={cn(
                        buttonVariants({ size: 'sm' }),
                        'inline-flex items-center'
                    )}
                >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload
                </Link>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-full"
                            />
                        }
                    >
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                            <User className="h-4 w-4 text-primary" />
                        </div>
                        <span className="sr-only">User menu</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuPositioner align="end">
                        <DropdownMenuContent className="w-56">
                            <div className="px-2 py-1.5">
                                <p className="text-sm font-medium">John Doe</p>
                                <p className="text-xs text-muted-foreground">
                                    john@example.com
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
                            <DropdownMenuItem render={<Link href="/" />}>
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

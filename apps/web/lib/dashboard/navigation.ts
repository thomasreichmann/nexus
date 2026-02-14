import type { LucideIcon } from 'lucide-react';
import {
    FolderOpen,
    LayoutDashboard,
    ListChecks,
    Settings,
    Upload,
} from 'lucide-react';

export interface NavItem {
    name: string;
    href: string;
    icon: LucideIcon;
    isAdminOnly?: boolean;
}

export const dashboardNavigation: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Files', href: '/dashboard/files', icon: FolderOpen },
    { name: 'Upload', href: '/dashboard/upload', icon: Upload },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
    {
        name: 'Jobs',
        href: '/dashboard/admin/jobs',
        icon: ListChecks,
        isAdminOnly: true,
    },
];

export function getNavItems(role?: string): NavItem[] {
    const isAdmin = role === 'admin';
    return dashboardNavigation.filter((item) => !item.isAdminOnly || isAdmin);
}

import { FolderOpen, LayoutDashboard, Settings, Upload } from 'lucide-react';

export const dashboardNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Files', href: '/dashboard/files', icon: FolderOpen },
    { name: 'Upload', href: '/dashboard/upload', icon: Upload },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

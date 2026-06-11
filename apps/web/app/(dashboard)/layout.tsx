import { Fraunces } from 'next/font/google';
import { DashboardHeader } from '@/components/dashboard/header';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import type { ReactNode } from 'react';

const fraunces = Fraunces({
    subsets: ['latin'],
    style: ['normal', 'italic'],
    axes: ['opsz'],
    variable: '--font-fraunces',
    display: 'swap',
});

export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <div
            className={`${fraunces.variable} descent flex h-screen overflow-hidden`}
        >
            <DashboardSidebar />
            <div className="flex flex-1 flex-col">
                <DashboardHeader />
                <main className="flex-1 overflow-y-auto bg-linear-to-b from-(--background) to-(--abyss) p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

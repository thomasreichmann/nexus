import { DashboardHeader } from '@/components/dashboard/header';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import type { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-screen overflow-hidden">
            <DashboardSidebar />
            {/* min-w-0: without it this flex item refuses to shrink below its
                content's min-content width, so one wide table blows the whole
                shell past the viewport instead of scrolling inside its own
                overflow-x-auto wrapper (#311). */}
            <div className="flex min-w-0 flex-1 flex-col">
                <DashboardHeader />
                <main className="flex-1 overflow-y-auto bg-muted/30 p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

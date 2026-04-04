import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

export default async function AdminLayout({
    children,
}: {
    children: ReactNode;
}) {
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    if (!session || session.user.role !== 'admin') {
        redirect('/dashboard');
    }

    return children;
}

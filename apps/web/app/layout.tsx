import { ClientErrorReporter } from '@/components/ClientErrorReporter';
import { ThemeProvider } from '@/components/theme-provider';
import { TRPCReactProvider } from '@/lib/trpc/client';
import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import './globals.css';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin'],
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin'],
});

export const metadata: Metadata = {
    title: 'Nexus - Deep Storage Made Simple',
    description:
        'Ultra-cheap archival storage for everyone. Store your files for $1/TB/month without the complexity.',
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: ReactNode;
}>) {
    const locale = await getLocale();

    return (
        <html lang={locale} suppressHydrationWarning>
            <body
                className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
            >
                <NextIntlClientProvider>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        <TRPCReactProvider>
                            <ClientErrorReporter />
                            {children}
                        </TRPCReactProvider>
                    </ThemeProvider>
                </NextIntlClientProvider>
                <Toaster />
                {/* Vercel injects /_vercel/insights/script.js only on its edge;
                    off-Vercel (local/CI production builds, e.g. e2e) that script
                    404s and pollutes the zero-console-error assertions, so only
                    mount it when actually deployed on Vercel. */}
                {process.env.VERCEL ? <Analytics /> : null}
            </body>
        </html>
    );
}

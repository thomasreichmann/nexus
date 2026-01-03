import Image from 'next/image';
import Link from 'next/link';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { UserInfoClient } from './user-info-client';
import { SignOutButton } from './sign-out-button';

export default async function Home() {
    // Server-side session fetch
    const session = await auth.api.getSession({
        headers: await headers(),
    });

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
            <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
                <Image
                    className="dark:invert"
                    src="/next.svg"
                    alt="Next.js logo"
                    width={100}
                    height={20}
                    priority
                />
                <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
                    <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
                        Nexus
                    </h1>
                    <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
                        Deep storage solution for long-term file archival.
                    </p>

                    {/* Auth Status Cards */}
                    <div className="flex w-full flex-col gap-3 sm:flex-row">
                        {/* Server-side (RSC) */}
                        <div className="flex-1 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                            <p className="text-xs font-medium uppercase text-green-500 dark:text-green-400">
                                Server (RSC)
                            </p>
                            {session ? (
                                <div className="mt-1">
                                    <p className="text-sm font-medium text-green-900 dark:text-green-100">
                                        {session.user.name}
                                    </p>
                                    <p className="text-xs text-green-600 dark:text-green-400">
                                        {session.user.email}
                                    </p>
                                </div>
                            ) : (
                                <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                                    Not logged in
                                </p>
                            )}
                        </div>

                        {/* Client-side (tRPC) */}
                        <div className="flex-1">
                            <UserInfoClient />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
                    {session ? (
                        <SignOutButton />
                    ) : (
                        <>
                            <Link
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-[158px]"
                                href="/login"
                            >
                                Login
                            </Link>
                            <Link
                                className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/8 px-5 transition-colors hover:border-transparent hover:bg-black/4 dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-[158px]"
                                href="/signup"
                            >
                                Sign Up
                            </Link>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}

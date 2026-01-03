'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        const { error } = await authClient.signIn.email({
            email,
            password,
        });

        if (error) {
            setError(error.message ?? 'An error occurred');
            setLoading(false);
        } else {
            router.push('/');
            router.refresh();
        }
    }

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    Welcome back
                </h1>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    Sign in to your account
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label
                        htmlFor="email"
                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                        Email
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        placeholder="you@example.com"
                    />
                </div>

                <div>
                    <label
                        htmlFor="password"
                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                        Password
                    </label>
                    <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        placeholder="Your password"
                    />
                </div>

                {error && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>
            </form>

            <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                Don&apos;t have an account?{' '}
                <Link
                    href="/signup"
                    className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                >
                    Sign up
                </Link>
            </p>
        </div>
    );
}

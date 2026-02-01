'use client';

import type React from 'react';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleIcon } from '@/components/icons/google-icon';
import { OAuthDivider } from '@/components/auth/oauth-divider';
import { signIn } from '@/lib/auth/client';
import { Loader2 } from 'lucide-react';

export function SignInForm() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const result = await signIn.email({
            email,
            password,
        });

        setIsLoading(false);

        if (result.error) {
            setError(result.error.message ?? 'Invalid email or password');
            return;
        }

        router.push('/dashboard');
    }

    async function onGoogleSignIn() {
        setIsGoogleLoading(true);
        // Google OAuth not configured yet - requires Google Cloud setup
        await new Promise((resolve) => setTimeout(resolve, 500));
        setIsGoogleLoading(false);
        setError('Google sign-in is not yet available');
    }

    return (
        <div className="space-y-6">
            <Button
                variant="outline"
                className="w-full bg-transparent"
                onClick={onGoogleSignIn}
                disabled={isGoogleLoading || isLoading}
            >
                {isGoogleLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <GoogleIcon className="mr-2 h-4 w-4" />
                )}
                Continue with Google
            </Button>

            <OAuthDivider />

            <form onSubmit={onSubmit} className="space-y-4">
                {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        required
                        disabled={isLoading}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        <Link
                            href="#"
                            className="text-xs text-muted-foreground hover:text-primary"
                        >
                            Forgot password?
                        </Link>
                    </div>
                    <Input
                        id="password"
                        type="password"
                        placeholder="Your password"
                        required
                        disabled={isLoading}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>
                <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || isGoogleLoading}
                >
                    {isLoading && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Sign in
                </Button>
            </form>
        </div>
    );
}

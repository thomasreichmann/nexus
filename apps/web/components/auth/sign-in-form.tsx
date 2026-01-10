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
import { Loader2 } from 'lucide-react';

export function SignInForm() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setIsLoading(true);
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setIsLoading(false);
        router.push('/dashboard');
    }

    async function onGoogleSignIn() {
        setIsGoogleLoading(true);
        // Simulate OAuth flow
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setIsGoogleLoading(false);
        router.push('/dashboard');
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
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        required
                        disabled={isLoading}
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

'use client';

import Link from 'next/link';

import type React from 'react';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleIcon } from '@/components/icons/google-icon';
import { OAuthDivider } from '@/components/auth/oauth-divider';
import { signUp } from '@/lib/auth/client';
import { DEFAULT_REDIRECT } from '@/lib/auth/sanitizeRedirect';

interface SignUpFormProps {
    /** Sanitized path to land on after a successful sign-up. */
    redirectTo?: string;
    /**
     * Sponsored invite token (#246). Rides the signup request body so the
     * user create-hook can provision sponsored access in the same request.
     */
    inviteToken?: string;
    /**
     * Email an invite is bound to. Locks the field so redemption can't be
     * silently downgraded to a trial by an email mismatch server-side.
     */
    lockedEmail?: string;
}

export function SignUpForm({
    redirectTo = DEFAULT_REDIRECT,
    inviteToken,
    lockedEmail,
}: SignUpFormProps) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState(lockedEmail ?? '');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const isEmailLocked = lockedEmail !== undefined;

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const result = await signUp.email({
            name,
            email,
            password,
            // Spread keeps the key out of normal signups entirely; better-auth
            // forwards extra body keys to the server hook (see lib/auth/server.ts).
            ...(inviteToken !== undefined && { inviteToken }),
        });

        setIsLoading(false);

        if (result.error) {
            setError(result.error.message ?? 'Failed to create account');
            return;
        }

        router.push(redirectTo);
    }

    async function onGoogleSignUp() {
        setIsGoogleLoading(true);
        // Google OAuth not configured yet - requires Google Cloud setup
        await new Promise((resolve) => setTimeout(resolve, 500));
        setIsGoogleLoading(false);
        setError('Google sign-up is not yet available');
    }

    return (
        <div className="space-y-6">
            {/* OAuth is a redirect flow — it can't carry the invite token in
                the signup body, so a Google signup here would silently land
                the tester on a trial. Hide it for invite redemptions. */}
            {inviteToken === undefined && (
                <>
                    <Button
                        variant="outline"
                        className="w-full bg-transparent"
                        onClick={onGoogleSignUp}
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
                </>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
                {error && (
                    <div
                        role="alert"
                        className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                    >
                        {error}
                    </div>
                )}
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                        id="name"
                        type="text"
                        placeholder="Your name"
                        required
                        disabled={isLoading}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        required
                        disabled={isLoading}
                        readOnly={isEmailLocked}
                        aria-readonly={isEmailLocked || undefined}
                        className={
                            isEmailLocked
                                ? 'bg-muted text-muted-foreground'
                                : undefined
                        }
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                    {isEmailLocked && (
                        <p className="text-xs text-muted-foreground">
                            Your invite is for this email address.
                        </p>
                    )}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                        id="password"
                        type="password"
                        placeholder="Create a password"
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
                    Create account
                </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">
                By signing up, you agree to our{' '}
                <Link
                    href="#"
                    className="underline underline-offset-4 hover:text-primary"
                >
                    Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                    href="#"
                    className="underline underline-offset-4 hover:text-primary"
                >
                    Privacy Policy
                </Link>
                .
            </p>
        </div>
    );
}

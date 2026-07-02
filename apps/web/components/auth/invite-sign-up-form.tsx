'use client';

import Link from 'next/link';

import type React from 'react';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signUp } from '@/lib/auth/client';
import { INVITE_TOKEN_COOKIE } from '@/lib/auth/inviteCookie';
import { DEFAULT_REDIRECT } from '@/lib/auth/sanitizeRedirect';

interface InviteSignUpFormProps {
    /** The redemption token; carried to the create-hook via a short-lived cookie. */
    token: string;
    /**
     * When the invite is email-bound, the address it was issued to. The field is
     * locked to it so the signup email can't drift from the invite — the server
     * treats a mismatch as an error (`subscriptions.ts`), so the UI makes one
     * unreachable rather than relying on that backstop.
     */
    boundEmail: string | null;
}

export function InviteSignUpForm({ token, boundEmail }: InviteSignUpFormProps) {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState(boundEmail ?? '');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        // The create-hook reads the token from this cookie (lib/auth/server.ts).
        // Set it just before signup and clear it in `finally` so it can never
        // ride along on a later, unrelated signup from the same browser — even
        // if the request throws. Short max-age is a backstop; SameSite=Lax
        // keeps it same-origin.
        setInviteCookie(token);
        try {
            const result = await signUp.email({ name, email, password });
            if (result.error) {
                setError(result.error.message ?? 'Failed to create account');
                return;
            }
            router.push(DEFAULT_REDIRECT);
        } catch {
            setError('Failed to create account');
        } finally {
            clearInviteCookie();
            setIsLoading(false);
        }
    }

    return (
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
                    // Email-bound invites lock the field to the invited
                    // address. `readOnly` covers the keyboard; ignoring
                    // onChange while bound pins the value against autofill or
                    // devtools tampering too, so the submitted email can't drift
                    // from the invite and silently downgrade to a trial.
                    readOnly={boundEmail !== null}
                    aria-readonly={boundEmail !== null}
                    value={email}
                    onChange={(e) => {
                        if (boundEmail === null) setEmail(e.target.value);
                    }}
                />
                {boundEmail !== null && (
                    <p className="text-xs text-muted-foreground">
                        This invite is for {boundEmail}.
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
            <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create account
            </Button>
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
        </form>
    );
}

function setInviteCookie(token: string): void {
    document.cookie = `${INVITE_TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=600; samesite=lax`;
}

function clearInviteCookie(): void {
    document.cookie = `${INVITE_TOKEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

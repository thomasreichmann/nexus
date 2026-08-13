'use client';

import type React from 'react';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { FormError, FormStatus } from '@/components/auth/form-feedback';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPassword, signOut } from '@/lib/auth/client';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/constants';
import { cn } from '@/lib/cn';

interface ResetPasswordFormProps {
    /** Token from the emailed link — validity is only known once submitted. */
    token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isReset, setIsReset] = useState(false);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const result = await resetPassword({ newPassword: password, token });

        // The reset revoked every session server-side, but this browser may
        // still hold the cookie of one — enough to fool the optimistic proxy
        // guard into bouncing the user off /sign-in and into a dead dashboard.
        // /sign-out clears the cookie whether or not a session backed it.
        if (!result.error) {
            await signOut();
        }

        setIsLoading(false);

        if (result.error) {
            // Covers the expired/already-used/tampered token cases, which
            // better-auth returns as a 400 rather than anything that throws.
            setError(
                result.error.message ??
                    'This reset link is no longer valid. Request a new one.'
            );
            return;
        }

        setIsReset(true);
    }

    if (isReset) {
        return (
            <div className="space-y-4">
                <FormStatus>
                    Your password has been changed. Any other devices signed
                    into Nexus have been signed out.
                </FormStatus>
                <Link
                    href="/sign-in"
                    className={cn(buttonVariants(), 'w-full')}
                >
                    Sign in
                </Link>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            {error && (
                <FormError>
                    {error}{' '}
                    <Link href="/forgot-password" className="underline">
                        Request a new link
                    </Link>
                </FormError>
            )}
            <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                    id="password"
                    type="password"
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    disabled={isLoading}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Set new password
            </Button>
        </form>
    );
}

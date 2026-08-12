'use client';

import type React from 'react';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FormError, FormStatus } from '@/components/auth/form-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordReset } from '@/lib/auth/client';
import { RESET_PASSWORD_TOKEN_TTL_LABEL } from '@/lib/auth/constants';

export function ForgotPasswordForm() {
    const [isLoading, setIsLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isRequested, setIsRequested] = useState(false);

    async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const result = await requestPasswordReset({ email });

        setIsLoading(false);

        if (result.error) {
            setError(
                result.error.message ??
                    'Could not send the reset link. Try again in a moment.'
            );
            return;
        }

        setIsRequested(true);
    }

    // Deliberately says nothing about whether the address has an account —
    // the endpoint answers identically either way, and so does this.
    if (isRequested) {
        return (
            <FormStatus>
                If an account exists for{' '}
                <span className="font-medium wrap-anywhere text-foreground">
                    {email}
                </span>
                , a reset link is on its way. The link expires in{' '}
                {RESET_PASSWORD_TOKEN_TTL_LABEL}.
            </FormStatus>
        );
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            {error && <FormError>{error}</FormError>}
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
            <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send reset link
            </Button>
        </form>
    );
}

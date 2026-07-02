import Link from 'next/link';
import { Shield, DollarSign, Archive } from 'lucide-react';
import { SignUpForm } from '@/components/auth/sign-up-form';
import {
    DEFAULT_REDIRECT,
    sanitizeRedirect,
} from '@/lib/auth/sanitizeRedirect';

interface SignUpPageProps {
    searchParams: Promise<{ redirect?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
    const { redirect } = await searchParams;
    const redirectTo = sanitizeRedirect(redirect);
    // Carry the redirect across to sign-in so switching forms keeps the target.
    const signInHref =
        redirectTo === DEFAULT_REDIRECT
            ? '/sign-in'
            : `/sign-in?redirect=${encodeURIComponent(redirectTo)}`;

    return (
        <div className="mx-auto w-full max-w-md">
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">Create your account</h1>
                <p className="text-muted-foreground">
                    Start storing your files securely for less
                </p>
            </div>
            <SignUpForm redirectTo={redirectTo} />
            <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                    href={signInHref}
                    className="font-medium text-primary hover:underline"
                >
                    Sign in
                </Link>
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                    <DollarSign className="size-3.5 text-primary" />
                    <span>5 GB free</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Shield className="size-3.5 text-primary" />
                    <span>Encrypted</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Archive className="size-3.5 text-primary" />
                    <span>No credit card</span>
                </div>
            </div>
        </div>
    );
}

import Link from 'next/link';
import { SignInForm } from '@/components/auth/sign-in-form';
import {
    DEFAULT_REDIRECT,
    sanitizeRedirect,
} from '@/lib/auth/sanitizeRedirect';

interface SignInPageProps {
    searchParams: Promise<{ redirect?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
    const { redirect } = await searchParams;
    const redirectTo = sanitizeRedirect(redirect);
    // Carry the redirect across to sign-up so switching forms keeps the target.
    const signUpHref =
        redirectTo === DEFAULT_REDIRECT
            ? '/sign-up'
            : `/sign-up?redirect=${encodeURIComponent(redirectTo)}`;

    return (
        <div className="mx-auto w-full max-w-md">
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">Welcome back</h1>
                <p className="text-muted-foreground">
                    Sign in to access your files
                </p>
            </div>
            <SignInForm redirectTo={redirectTo} />
            <p className="mt-6 text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link
                    href={signUpHref}
                    className="font-medium text-primary hover:underline"
                >
                    Sign up
                </Link>
            </p>
        </div>
    );
}

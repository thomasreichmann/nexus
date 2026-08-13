import Link from 'next/link';
import { AuthPageShell } from '@/components/auth/auth-page-shell';
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
        <AuthPageShell
            title="Welcome back"
            subtitle="Sign in to access your files"
            footer={
                <>
                    Don&apos;t have an account?{' '}
                    <Link
                        href={signUpHref}
                        className="font-medium text-primary hover:underline"
                    >
                        Sign up
                    </Link>
                </>
            }
        >
            <SignInForm redirectTo={redirectTo} />
        </AuthPageShell>
    );
}

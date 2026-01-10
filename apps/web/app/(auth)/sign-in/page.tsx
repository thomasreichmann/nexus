import Link from 'next/link';
import { SignInForm } from '@/components/auth/sign-in-form';

export default function SignInPage() {
    return (
        <div className="mx-auto w-full max-w-md">
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">Welcome back</h1>
                <p className="text-muted-foreground">
                    Sign in to access your files
                </p>
            </div>
            <SignInForm />
            <p className="mt-6 text-center text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
                <Link
                    href="/sign-up"
                    className="font-medium text-primary hover:underline"
                >
                    Sign up
                </Link>
            </p>
        </div>
    );
}

import Link from 'next/link';
import { AuthPageShell } from '@/components/auth/auth-page-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export default function ForgotPasswordPage() {
    return (
        <AuthPageShell
            title="Forgot your password?"
            subtitle="Enter your email and we'll send a link to choose a new one"
            footer={
                <>
                    Remembered it?{' '}
                    <Link
                        href="/sign-in"
                        className="font-medium text-primary hover:underline"
                    >
                        Sign in
                    </Link>
                </>
            }
        >
            <ForgotPasswordForm />
        </AuthPageShell>
    );
}
